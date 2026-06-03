import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@modules/database';
import { ProviderAvailabilityService } from '@modules/scheduling/provider-availability.service';
import { subtractWindow, sliceWindow } from '@common/utils/interval-math';
import type { TimeWindow } from '@common/utils/interval-math';
import { DEFAULT_TIMEZONE } from '@common/constants/app.constants';

export const SLOT_TIMEZONE = DEFAULT_TIMEZONE;
const VN_OFFSET_MINUTES = 7 * 60;

export interface BookableSlot {
  start: string;
  end: string;
  providerIds: string[];
}

export interface BookableSlotsResult {
  date: string;
  slots: BookableSlot[];
}

export interface GetBookableSlotsParams {
  typeId: string;
  providerId?: string;
  date: string;
}

function hhmmToUtcIso(date: string, hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const totalUtcMinutes = h * 60 + m - VN_OFFSET_MINUTES;
  const utcH = Math.floor((((totalUtcMinutes % 1440) + 1440) % 1440) / 60);
  const utcM = (((totalUtcMinutes % 1440) + 1440) % 1440) % 60;
  return `${date}T${String(utcH).padStart(2, '0')}:${String(utcM).padStart(2, '0')}:00.000Z`;
}

function toHHmm(date: Date): string {
  const totalUtcMinutes = date.getUTCHours() * 60 + date.getUTCMinutes();
  const vnMinutes = (totalUtcMinutes + VN_OFFSET_MINUTES) % 1440;
  const h = Math.floor(vnMinutes / 60);
  const m = vnMinutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function vnTodayDateStr(): string {
  const nowUtc = new Date();
  const vnMs = nowUtc.getTime() + VN_OFFSET_MINUTES * 60_000;
  const vnDate = new Date(vnMs);
  const y = vnDate.getUTCFullYear();
  const mo = String(vnDate.getUTCMonth() + 1).padStart(2, '0');
  const d = String(vnDate.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${d}`;
}

function isDateInBookingWindow(dateStr: string): boolean {
  const todayStr = vnTodayDateStr();
  const todayMs = new Date(`${todayStr}T00:00:00.000Z`).getTime();
  const targetMs = new Date(`${dateStr}T00:00:00.000Z`).getTime();
  const tomorrowMs = todayMs + 86_400_000;
  const maxMs = todayMs + 14 * 86_400_000;
  return targetMs >= tomorrowMs && targetMs <= maxMs;
}

@Injectable()
export class BookingSlotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly availability: ProviderAvailabilityService,
  ) {}

  async getBookableSlots(
    params: GetBookableSlotsParams,
  ): Promise<BookableSlotsResult> {
    const { typeId, providerId, date } = params;

    if (!isDateInBookingWindow(date)) {
      return { date, slots: [] };
    }

    const apptType = await this.prisma.baseClient.appointmentType.findUnique({
      where: { id: typeId },
      select: { id: true, durationMinutes: true },
    });
    if (!apptType) {
      throw new NotFoundException(`Appointment type ${typeId} not found`);
    }

    const junctionRows =
      await this.prisma.baseClient.providerAppointmentType.findMany({
        where: { appointmentTypeId: typeId },
        select: { providerId: true },
      });

    let eligibleProviderIds = junctionRows.map((r) => r.providerId);

    if (providerId) {
      if (!eligibleProviderIds.includes(providerId)) {
        return { date, slots: [] };
      }
      eligibleProviderIds = [providerId];
    }

    if (eligibleProviderIds.length === 0) {
      return { date, slots: [] };
    }

    const slotMap = new Map<string, BookableSlot>();

    await Promise.all(
      eligibleProviderIds.map(async (pid) => {
        const slots = await this.getSlotsForProvider(
          pid,
          date,
          apptType.durationMinutes,
        );
        for (const slot of slots) {
          const key = `${slot.start}|${slot.end}`;
          const existing = slotMap.get(key);
          if (existing) {
            existing.providerIds.push(pid);
          } else {
            slotMap.set(key, {
              start: slot.start,
              end: slot.end,
              providerIds: [pid],
            });
          }
        }
      }),
    );

    const slots = Array.from(slotMap.values()).sort((a, b) =>
      a.start.localeCompare(b.start),
    );

    return { date, slots };
  }

  private async getSlotsForProvider(
    providerId: string,
    date: string,
    durationMinutes: number,
  ): Promise<{ start: string; end: string }[]> {
    const availResult = await this.availability.getAvailability(
      providerId,
      date,
    );

    if (availResult.windows.length === 0) {
      return [];
    }

    const dayStart = new Date(`${date}T00:00:00.000Z`);
    const dayEnd = new Date(`${date}T23:59:59.999Z`);

    const bookings = await this.prisma.baseClient.appointment.findMany({
      where: {
        providerId,
        // Overlap (not containment): catch appointments that cross the day
        // boundary so their slots aren't shown as available.
        startTime: { lt: dayEnd },
        endTime: { gt: dayStart },
        status: { notIn: ['cancelled', 'no_show'] },
      },
      select: { startTime: true, endTime: true },
    });

    let windows: TimeWindow[] = availResult.windows.map((w) => ({
      start: w.start,
      end: w.end,
      source: w.source,
    }));

    for (const booking of bookings) {
      const bookedStart = toHHmm(booking.startTime);
      const bookedEnd = toHHmm(booking.endTime);
      windows = subtractWindow(windows, bookedStart, bookedEnd);
    }

    const slots: { start: string; end: string }[] = [];

    for (const window of windows) {
      const startTimes = sliceWindow(window, durationMinutes);
      for (const startHHmm of startTimes) {
        const [sh, sm] = startHHmm.split(':').map(Number);
        const endMin = sh * 60 + sm + durationMinutes;
        const endHHmm = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;
        slots.push({
          start: hhmmToUtcIso(date, startHHmm),
          end: hhmmToUtcIso(date, endHHmm),
        });
      }
    }

    return slots;
  }
}
