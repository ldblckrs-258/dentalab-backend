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
        },
      });

    const hasApprovedDayOff = approvedOverrides.some(
      (o) => o.overrideType === 'day_off',
    );

    if (hasApprovedDayOff) {
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

    let windows: AvailabilityWindow[] = baseSchedules.map((s) => ({
      start: s.startTime,
      end: s.endTime,
      source: 'schedule' as const,
    }));

    const customHoursOverrides = approvedOverrides.filter(
      (o) => o.overrideType === 'custom_hours' && o.startTime && o.endTime,
    );

    for (const override of customHoursOverrides) {
      windows = this.subtractWindow(
        windows,
        override.startTime!,
        override.endTime!,
      );
      windows.push({
        start: override.startTime!,
        end: override.endTime!,
        source: 'override',
      });
    }

    windows.sort((a, b) => a.start.localeCompare(b.start));

    return {
      providerId,
      date: dateStr,
      dayOfWeek,
      windows,
      hasApprovedDayOff: false,
    };
  }

  private subtractWindow(
    windows: AvailabilityWindow[],
    subStart: string,
    subEnd: string,
  ): AvailabilityWindow[] {
    const result: AvailabilityWindow[] = [];

    for (const w of windows) {
      // No overlap
      if (w.end <= subStart || w.start >= subEnd) {
        result.push(w);
        continue;
      }

      // Left portion (before override start)
      if (w.start < subStart) {
        result.push({
          start: w.start,
          end: subStart,
          source: w.source,
        });
      }

      // Right portion (after override end)
      if (w.end > subEnd) {
        result.push({
          start: subEnd,
          end: w.end,
          source: w.source,
        });
      }
      // If full overlap, neither portion is kept (entire window consumed)
    }

    return result;
  }
}
