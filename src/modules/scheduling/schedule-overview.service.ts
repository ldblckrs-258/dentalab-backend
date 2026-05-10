import { Injectable } from '@nestjs/common';
import { PrismaService } from '@modules/database';
import { AppConfigService } from '@modules/config';
import { ScheduleOverviewQueryDto } from './dto/schedule-overview-query.dto';
import type { ScheduleOverviewResponse } from './dto/schedule-overview-response.dto';

@Injectable()
export class ScheduleOverviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  async getScheduleOverview(
    query: ScheduleOverviewQueryDto,
  ): Promise<ScheduleOverviewResponse> {
    const fromDate = new Date(query.from);
    const toDate = new Date(query.to);

    const providerFilter: Record<string, unknown> = { isActive: true };
    if (query.providerId && query.providerId.length > 0) {
      providerFilter.id = { in: query.providerId };
    }
    if (query.specialty && query.specialty.length > 0) {
      providerFilter.specialty = { in: query.specialty };
    }

    const providers = await this.prisma.baseClient.provider.findMany({
      where: providerFilter,
      select: {
        id: true,
        specialty: true,
        user: {
          select: {
            fullName: true,
            avatarUrl: true,
          },
        },
      },
    });

    const providerIds = providers.map((p) => p.id);

    const overrideFilter: Record<string, unknown> = {
      providerId: { in: providerIds },
      specificDate: {
        gte: fromDate,
        lte: toDate,
      },
    };
    if (query.overrideStatus && query.overrideStatus.length > 0) {
      overrideFilter.status = { in: query.overrideStatus };
    }

    const [schedules, overrides, appointments] = await Promise.all([
      this.prisma.baseClient.providerSchedule.findMany({
        where: { providerId: { in: providerIds } },
        select: {
          id: true,
          providerId: true,
          dayOfWeek: true,
          startTime: true,
          endTime: true,
          isAvailable: true,
        },
      }),
      this.prisma.baseClient.providerScheduleOverride.findMany({
        where: overrideFilter,
        select: {
          id: true,
          providerId: true,
          specificDate: true,
          overrideType: true,
          startTime: true,
          endTime: true,
          status: true,
          requestedBy: true,
          requestedAt: true,
          reviewedBy: true,
          reviewedAt: true,
          reviewNote: true,
          reason: true,
        },
      }),
      this.prisma.baseClient.appointment.findMany({
        where: {
          providerId: { in: providerIds },
          status: { notIn: ['cancelled'] },
          startTime: { gte: fromDate, lte: toDate },
        },
        select: { providerId: true, startTime: true },
      }),
    ]);

    const staleDays = this.config.app.SCHEDULE_OVERRIDE_STALE_DAYS;
    const staleThreshold = new Date();
    staleThreshold.setUTCDate(staleThreshold.getUTCDate() - staleDays);

    const overridesWithStale = overrides.map((o) => ({
      ...o,
      specificDate: o.specificDate.toISOString().split('T')[0],
      requestedAt: o.requestedAt.toISOString(),
      reviewedAt: o.reviewedAt?.toISOString() ?? null,
      isStale: o.status === 'pending' && o.requestedAt < staleThreshold,
    }));

    const countByKey = new Map<string, number>();
    for (const apt of appointments) {
      const dateStr = apt.startTime.toISOString().split('T')[0];
      const key = `${apt.providerId}|${dateStr}`;
      countByKey.set(key, (countByKey.get(key) ?? 0) + 1);
    }

    const appointmentCounts = Array.from(countByKey, ([key, count]) => {
      const [providerId, date] = key.split('|');
      return { providerId, date, count };
    });

    return {
      providers: providers.map((p) => ({
        id: p.id,
        fullName: p.user.fullName,
        avatarUrl: p.user.avatarUrl,
        specialty: p.specialty,
      })),
      schedules,
      overrides: overridesWithStale,
      appointmentCounts,
    };
  }
}
