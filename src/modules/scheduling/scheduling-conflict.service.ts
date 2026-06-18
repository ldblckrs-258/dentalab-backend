import { PrismaService } from '@modules/database';
import { Injectable } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@prisma/client';

export interface ConflictResult {
  id: string;
  startTime: Date;
  endTime: Date;
  status: string;
}

export interface SerializedConflict {
  id: string;
  startTime: string;
  endTime: string;
}

export function serializeConflicts(
  conflicts: readonly ConflictResult[],
): SerializedConflict[] {
  return conflicts.map((c) => ({
    id: c.id,
    startTime: c.startTime.toISOString(),
    endTime: c.endTime.toISOString(),
  }));
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// Shift HH:MM strings are clinic-local (Asia/Saigon); appointment timestamps
// are stored in UTC. Convert an appointment instant to its local wall clock so
// day-of-week and minute-of-day line up with the shift strings.
const VN_OFFSET_MINUTES = 7 * 60;

function toLocalWallClock(date: Date): { dow: number; minutes: number } {
  const local = new Date(date.getTime() + VN_OFFSET_MINUTES * 60_000);
  return {
    dow: local.getUTCDay(),
    minutes: local.getUTCHours() * 60 + local.getUTCMinutes(),
  };
}

// Resolve a clinic-local date + HH:MM to the matching UTC instant.
function localTimeToUtc(dateStr: string, hhmm: string): Date {
  return new Date(`${dateStr}T${hhmm}:00.000+07:00`);
}

@Injectable()
export class SchedulingConflictService {
  constructor(private readonly prisma: PrismaService) {}

  private getDb(db?: Prisma.TransactionClient) {
    return (db ?? this.prisma.baseClient) as
      | Prisma.TransactionClient
      | PrismaClient;
  }

  async validateBulkRecurringSchedules(
    providerId: string,
    shifts: ReadonlyArray<{
      dayOfWeek: number;
      startTime: string;
      endTime: string;
    }>,
    db?: Prisma.TransactionClient,
  ): Promise<ConflictResult[]> {
    const client = this.getDb(db);
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(0, 0, 0, 0);

    const futureAppointments = await client.$queryRaw<
      Array<{
        id: string;
        startTime: Date;
        endTime: Date;
        status: string;
      }>
    >`
      SELECT id,
             start_time as "startTime",
             end_time as "endTime",
             status
      FROM appointments
      WHERE provider_id = ${providerId}::uuid
        AND status <> 'cancelled'
        AND start_time >= ${tomorrow}
    `;

    const shiftsByDow = new Map<
      number,
      Array<{ start: number; end: number }>
    >();
    for (const s of shifts) {
      const arr = shiftsByDow.get(s.dayOfWeek) ?? [];
      arr.push({ start: toMinutes(s.startTime), end: toMinutes(s.endTime) });
      shiftsByDow.set(s.dayOfWeek, arr);
    }

    return futureAppointments
      .filter((apt) => {
        const start = toLocalWallClock(apt.startTime);
        const end = toLocalWallClock(apt.endTime);
        const dowShifts = shiftsByDow.get(start.dow) ?? [];
        const covered = dowShifts.some(
          (s) => start.minutes >= s.start && end.minutes <= s.end,
        );
        return !covered;
      })
      .map((apt) => ({
        id: apt.id,
        startTime: apt.startTime,
        endTime: apt.endTime,
        status: apt.status,
      }));
  }

  async validateRecurringScheduleChange(
    providerId: string,
    dayOfWeek: number,
    startTime: string,
    endTime: string,
    db?: Prisma.TransactionClient,
  ): Promise<ConflictResult[]> {
    const client = this.getDb(db);
    const startMinutes = toMinutes(startTime);
    const endMinutes = toMinutes(endTime);

    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(0, 0, 0, 0);

    // Day-of-week is resolved against the clinic-local wall clock (below), so
    // the SQL filter only bounds the future window; the DOW match happens in JS.
    const futureAppointments = await client.$queryRaw<
      Array<{
        id: string;
        startTime: Date;
        endTime: Date;
        status: string;
      }>
    >`
      SELECT id, start_time as "startTime", end_time as "endTime", status
      FROM appointments
      WHERE provider_id = ${providerId}::uuid
        AND status <> 'cancelled'
        AND start_time >= ${tomorrow}
    `;

    return futureAppointments
      .filter((apt) => {
        const start = toLocalWallClock(apt.startTime);
        if (start.dow !== dayOfWeek) return false;
        const end = toLocalWallClock(apt.endTime);
        return start.minutes < startMinutes || end.minutes > endMinutes;
      })
      .map((apt) => ({
        id: apt.id,
        startTime: apt.startTime,
        endTime: apt.endTime,
        status: apt.status,
      }));
  }

  async validateOverrideApproval(
    providerId: string,
    specificDate: Date,
    overrideType: string,
    startTime: string | null,
    endTime: string | null,
    db?: Prisma.TransactionClient,
    targetScheduleId?: string | null,
  ): Promise<ConflictResult[]> {
    const client = this.getDb(db);
    const dateStr = specificDate.toISOString().split('T')[0];
    const dateStart = localTimeToUtc(dateStr, '00:00');
    const dateEnd = new Date(dateStart.getTime() + 24 * 60 * 60 * 1000);

    const appointments = await client.appointment.findMany({
      where: {
        providerId,
        status: { notIn: ['cancelled'] },
        startTime: { gte: dateStart, lt: dateEnd },
      },
      select: {
        id: true,
        startTime: true,
        endTime: true,
        status: true,
      },
    });

    if (targetScheduleId) {
      const shift = await client.providerSchedule.findUnique({
        where: { id: targetScheduleId },
        select: { startTime: true, endTime: true },
      });
      if (!shift) return [];

      const shiftStart = localTimeToUtc(dateStr, shift.startTime);
      const shiftEnd = localTimeToUtc(dateStr, shift.endTime);

      const inTargetShift = appointments.filter(
        (apt) => apt.startTime >= shiftStart && apt.endTime <= shiftEnd,
      );

      if (overrideType === 'day_off') {
        return inTargetShift.map((apt) => ({
          id: apt.id,
          startTime: apt.startTime,
          endTime: apt.endTime,
          status: apt.status,
        }));
      }

      if (overrideType === 'custom_hours' && startTime && endTime) {
        const windowStart = localTimeToUtc(dateStr, startTime);
        const windowEnd = localTimeToUtc(dateStr, endTime);

        return inTargetShift
          .filter(
            (apt) => apt.startTime < windowStart || apt.endTime > windowEnd,
          )
          .map((apt) => ({
            id: apt.id,
            startTime: apt.startTime,
            endTime: apt.endTime,
            status: apt.status,
          }));
      }

      return [];
    }

    if (overrideType === 'day_off') {
      return appointments.map((apt) => ({
        id: apt.id,
        startTime: apt.startTime,
        endTime: apt.endTime,
        status: apt.status,
      }));
    }

    if (overrideType === 'custom_hours' && startTime && endTime) {
      const windowStart = localTimeToUtc(dateStr, startTime);
      const windowEnd = localTimeToUtc(dateStr, endTime);

      return appointments
        .filter((apt) => apt.startTime < windowStart || apt.endTime > windowEnd)
        .map((apt) => ({
          id: apt.id,
          startTime: apt.startTime,
          endTime: apt.endTime,
          status: apt.status,
        }));
    }

    return [];
  }
}
