import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '@modules/database';

export interface AvailabilityWindow {
  start: string;
  end: string;
  source: 'schedule' | 'override';
}

export interface ProviderAvailabilityResult {
  providerId: string;
  date: string;
  dayOfWeek: number;
  windows: AvailabilityWindow[];
  hasApprovedDayOff: boolean;
}

@Injectable()
export class ProviderAvailabilityService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Batch availability lookup for the calendar UI. Caps providers at 10 and
   * span at 14 days to bound response size and DB load.
   */
  async getBatchAvailability(
    providerIds: string[],
    from: string,
    to: string,
  ): Promise<ProviderAvailabilityResult[]> {
    const fromDate = new Date(`${from.substring(0, 10)}T00:00:00.000Z`);
    const toDate = new Date(`${to.substring(0, 10)}T00:00:00.000Z`);
    const dayMs = 86_400_000;
    const spanDays = Math.floor(
      (toDate.getTime() - fromDate.getTime()) / dayMs,
    );
    if (spanDays < 0) {
      throw new BadRequestException('to must be after from');
    }
    if (spanDays > 14) {
      throw new BadRequestException(
        'Span between from and to cannot exceed 14 days',
      );
    }

    const dates: string[] = [];
    for (let i = 0; i <= spanDays; i += 1) {
      const d = new Date(fromDate.getTime() + i * dayMs);
      dates.push(d.toISOString().substring(0, 10));
    }

    const results = await Promise.all(
      providerIds.flatMap((providerId) =>
        dates.map((date) => this.getAvailability(providerId, date)),
      ),
    );
    return results;
  }

  async getAvailability(
    providerId: string,
    dateStr: string,
  ): Promise<ProviderAvailabilityResult> {
    const date = new Date(dateStr);
    const dayOfWeek = date.getUTCDay();

    const normalizedDate = dateStr.substring(0, 10);
    const dayStart = new Date(`${normalizedDate}T00:00:00.000Z`);
    const dayEnd = new Date(`${normalizedDate}T23:59:59.999Z`);

    const approvedOverrides =
      await this.prisma.baseClient.providerScheduleOverride.findMany({
        where: {
          providerId,
          status: 'approved',
          specificDate: { gte: dayStart, lte: dayEnd },
        },
        select: {
          id: true,
          overrideType: true,
          startTime: true,
          endTime: true,
          targetScheduleId: true,
        },
      });

    const dayOffOverrides = approvedOverrides.filter(
      (o) => o.overrideType === 'day_off',
    );

    // A day_off with no target removes the entire day.
    const hasWholeDayOff = dayOffOverrides.some((o) => !o.targetScheduleId);
    if (hasWholeDayOff) {
      return {
        providerId,
        date: dateStr,
        dayOfWeek,
        windows: [],
        hasApprovedDayOff: true,
      };
    }

    const baseSchedules =
      await this.prisma.baseClient.providerSchedule.findMany({
        where: {
          providerId,
          dayOfWeek,
          isAvailable: true,
        },
        select: {
          id: true,
          startTime: true,
          endTime: true,
        },
        orderBy: { startTime: 'asc' },
      });

    const customOverrides = approvedOverrides.filter(
      (o) => o.overrideType === 'custom_hours' && o.startTime && o.endTime,
    );

    // Custom hours replace the day's normal schedule rather than extend it. A
    // targeted override swaps out only its shift; a whole-day override (no
    // target) drops every regular shift. Targeted day_off removes just its
    // shift. Mirrors the resolution shown on the /schedule timeline.
    const replacedShiftIds = new Set<string>(
      [...dayOffOverrides, ...customOverrides]
        .map((o) => o.targetScheduleId)
        .filter((id): id is string => Boolean(id)),
    );
    const hasWholeDayCustom = customOverrides.some((o) => !o.targetScheduleId);

    const scheduleWindows: AvailabilityWindow[] = hasWholeDayCustom
      ? []
      : baseSchedules
          .filter((s) => !replacedShiftIds.has(s.id))
          .map((s) => ({
            start: s.startTime,
            end: s.endTime,
            source: 'schedule' as const,
          }));

    const overrideWindows: AvailabilityWindow[] = customOverrides.map((o) => ({
      start: o.startTime!,
      end: o.endTime!,
      source: 'override' as const,
    }));

    const windows = [...scheduleWindows, ...overrideWindows].sort((a, b) =>
      a.start.localeCompare(b.start),
    );

    return {
      providerId,
      date: dateStr,
      dayOfWeek,
      windows,
      hasApprovedDayOff: false,
    };
  }
}
