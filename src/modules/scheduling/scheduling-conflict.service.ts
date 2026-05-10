import { Injectable } from '@nestjs/common';
import { PrismaService } from '@modules/database';
import type { PrismaClient, Prisma } from '@prisma/client';

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

@Injectable()
export class SchedulingConflictService {
  constructor(private readonly prisma: PrismaService) {}

  private getDb(db?: Prisma.TransactionClient) {
    return (db ?? this.prisma.baseClient) as
      | Prisma.TransactionClient
      | PrismaClient;
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

    // Push day-of-week predicate to Postgres so we don't pull every future
    // appointment into Node memory for busy providers.
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
        AND EXTRACT(DOW FROM start_time AT TIME ZONE 'UTC')::int = ${dayOfWeek}
    `;

    return futureAppointments
      .filter((apt) => {
        const aptStartMinutes =
          apt.startTime.getUTCHours() * 60 + apt.startTime.getUTCMinutes();
        const aptEndMinutes =
          apt.endTime.getUTCHours() * 60 + apt.endTime.getUTCMinutes();
        return aptStartMinutes < startMinutes || aptEndMinutes > endMinutes;
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
  ): Promise<ConflictResult[]> {
    const client = this.getDb(db);
    const dateStr = specificDate.toISOString().split('T')[0];
    const dateStart = new Date(`${dateStr}T00:00:00.000Z`);
    const dateEnd = new Date(`${dateStr}T23:59:59.999Z`);

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

    if (overrideType === 'day_off') {
      return appointments.map((apt) => ({
        id: apt.id,
        startTime: apt.startTime,
        endTime: apt.endTime,
        status: apt.status,
      }));
    }

    if (overrideType === 'custom_hours' && startTime && endTime) {
      const windowStart = new Date(`${dateStr}T${startTime}:00.000Z`);
      const windowEnd = new Date(`${dateStr}T${endTime}:00.000Z`);

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
