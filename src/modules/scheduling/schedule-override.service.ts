import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import dayjs from 'dayjs';
import { PrismaService } from '@modules/database';
import { AuditService } from '@modules/audit';
import { buildPrismaQuery, buildPaginatedResponse } from '@modules/pagination';
import { t } from '@common/utils';
import type { AuthenticatedUser } from '@common/interfaces';
import type { CreateScheduleOverrideDto } from './dto/create-schedule-override.dto';
import type { ReviewScheduleOverrideDto } from './dto/review-schedule-override.dto';
import type { ScheduleOverrideQueryDto } from './dto/schedule-override-query.dto';

const SCHEDULE_OVERRIDE_SELECT = {
  id: true,
  providerId: true,
  requestedBy: true,
  specificDate: true,
  overrideType: true,
  startTime: true,
  endTime: true,
  reason: true,
  status: true,
  requestedAt: true,
  reviewedBy: true,
  reviewedAt: true,
  reviewNote: true,
} as const;

@Injectable()
export class ScheduleOverrideService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async assertOwnProvider(
    currentUser: AuthenticatedUser,
    providerId: string,
  ): Promise<void> {
    const provider = await this.prisma.baseClient.provider.findFirst({
      where: { userId: currentUser.id },
      select: { id: true },
    });
    if (!provider || provider.id !== providerId) {
      throw new ForbiddenException(
        t('scheduling.notOwnProvider', 'Provider does not belong to you'),
      );
    }
  }

  async create(dto: CreateScheduleOverrideDto, currentUser: AuthenticatedUser) {
    // Doctors can only request overrides for their own provider record.
    // Admin/Manager have no linked provider and may specify any providerId.
    const userProvider = await this.prisma.baseClient.provider.findFirst({
      where: { userId: currentUser.id },
      select: { id: true },
    });
    if (userProvider && userProvider.id !== dto.providerId) {
      throw new ForbiddenException(
        t('scheduling.notOwnProvider', 'Provider does not belong to you'),
      );
    }

    return this.prisma.baseClient.providerScheduleOverride.create({
      data: {
        providerId: dto.providerId,
        requestedBy: currentUser.id,
        specificDate: dto.specificDate,
        overrideType: dto.overrideType,
        startTime:
          dto.overrideType === 'custom_hours' ? (dto.startTime ?? null) : null,
        endTime:
          dto.overrideType === 'custom_hours' ? (dto.endTime ?? null) : null,
        reason: dto.reason,
        status: 'pending',
        requestedAt: new Date(),
      },
      select: SCHEDULE_OVERRIDE_SELECT,
    });
  }

  async findById(id: string) {
    return this.findOverrideOrFail(id);
  }

  async findAll(query: ScheduleOverrideQueryDto) {
    const prismaArgs = buildPrismaQuery(
      query,
      ['requestedAt', 'specificDate'],
      { requestedAt: 'desc' },
    );

    const where: Record<string, unknown> = {};
    if (query.providerId) where.providerId = query.providerId;
    if (query.status) where.status = query.status;
    if (query.overrideType) where.overrideType = query.overrideType;
    if (query.dateFrom || query.dateTo) {
      where.specificDate = {
        ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
        ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
      };
    }

    const [data, total] = await Promise.all([
      this.prisma.baseClient.providerScheduleOverride.findMany({
        ...prismaArgs,
        where,
        select: SCHEDULE_OVERRIDE_SELECT,
      }),
      this.prisma.baseClient.providerScheduleOverride.count({ where }),
    ]);

    return buildPaginatedResponse(data, total, query);
  }

  async findPending(query: ScheduleOverrideQueryDto) {
    const prismaArgs = buildPrismaQuery(
      query,
      ['requestedAt', 'specificDate'],
      { requestedAt: 'desc' },
    );

    const where: Record<string, unknown> = { status: 'pending' };
    if (query.providerId) where.providerId = query.providerId;
    if (query.overrideType) where.overrideType = query.overrideType;
    if (query.dateFrom || query.dateTo) {
      where.specificDate = {
        ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
        ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
      };
    }

    const [data, total] = await Promise.all([
      this.prisma.baseClient.providerScheduleOverride.findMany({
        ...prismaArgs,
        where,
        select: SCHEDULE_OVERRIDE_SELECT,
      }),
      this.prisma.baseClient.providerScheduleOverride.count({ where }),
    ]);

    return buildPaginatedResponse(data, total, query);
  }

  async findMine(
    currentUser: AuthenticatedUser,
    query: ScheduleOverrideQueryDto,
  ) {
    const provider = await this.prisma.baseClient.provider.findFirst({
      where: { userId: currentUser.id },
      select: { id: true },
    });

    const prismaArgs = buildPrismaQuery(
      query,
      ['requestedAt', 'specificDate'],
      { requestedAt: 'desc' },
    );

    if (!provider) {
      return buildPaginatedResponse([], 0, query);
    }

    const where: Record<string, unknown> = { providerId: provider.id };
    if (query.status) where.status = query.status;
    if (query.overrideType) where.overrideType = query.overrideType;
    if (query.dateFrom || query.dateTo) {
      where.specificDate = {
        ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
        ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
      };
    }

    const [data, total] = await Promise.all([
      this.prisma.baseClient.providerScheduleOverride.findMany({
        ...prismaArgs,
        where,
        select: SCHEDULE_OVERRIDE_SELECT,
      }),
      this.prisma.baseClient.providerScheduleOverride.count({ where }),
    ]);

    return buildPaginatedResponse(data, total, query);
  }

  async review(
    id: string,
    dto: ReviewScheduleOverrideDto,
    currentUser: AuthenticatedUser,
  ) {
    const override = await this.findOverrideOrFail(id);

    let conflictList: Array<{
      id: string;
      startTime: Date;
      endTime: Date;
      status: string;
    }> = [];

    await this.prisma.transaction(async (tx) => {
      const updateData: Record<string, unknown> = {
        status: dto.decision === 'approve' ? 'approved' : 'rejected',
        reviewedBy: currentUser.id,
        reviewedAt: new Date(),
      };
      if (dto.reviewNote !== undefined) {
        updateData.reviewNote = dto.reviewNote;
      }

      await tx.providerScheduleOverride.update({
        where: { id },
        data: updateData,
      });

      if (dto.decision === 'approve') {
        const dateStr = dayjs(override.specificDate).format('YYYY-MM-DD');
        const dateStart = new Date(`${dateStr}T00:00:00.000Z`);
        const dateEnd = new Date(`${dateStr}T23:59:59.999Z`);

        const appointments = await tx.appointment.findMany({
          where: {
            providerId: override.providerId,
            status: { notIn: ['cancelled'] },
            startTime: { gte: dateStart, lt: dateEnd },
          },
          select: { id: true, startTime: true, endTime: true, status: true },
        });

        if (override.overrideType === 'day_off') {
          conflictList = appointments;
        } else if (
          override.overrideType === 'custom_hours' &&
          override.startTime &&
          override.endTime
        ) {
          const [startH, startM] = override.startTime.split(':').map(Number);
          const [endH, endM] = override.endTime.split(':').map(Number);
          const dateStr = dayjs(override.specificDate).format('YYYY-MM-DD');
          const windowStart = new Date(
            `${dateStr}T${String(startH).padStart(2, '0')}:${String(startM).padStart(2, '0')}:00`,
          );
          const windowEnd = new Date(
            `${dateStr}T${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}:00`,
          );

          conflictList = appointments.filter(
            (apt) => apt.startTime < windowEnd && apt.endTime > windowStart,
          );
        }

        if (conflictList.length > 0 && !dto.force) {
          throw new ConflictException({
            code: 'OVERRIDE_HAS_CONFLICTS',
            message: t(
              'scheduling.overrideConflicts',
              'Schedule override has conflicting appointments',
            ),
            conflicts: conflictList,
          });
        }
      }
    });

    this.auditService.emit({
      code:
        dto.decision === 'approve'
          ? 'SCHEDULE_OVERRIDE_APPROVED'
          : 'SCHEDULE_OVERRIDE_REJECTED',
      resource: 'schedule_override',
      resourceId: id,
      metadata: {
        ...(conflictList.length > 0 && { conflictCount: conflictList.length }),
      },
    });

    return {
      id,
      status: dto.decision === 'approve' ? 'approved' : 'rejected',
      ...(conflictList.length > 0 && { conflictList }),
    };
  }

  async cancel(id: string, currentUser: AuthenticatedUser) {
    const override = await this.findOverrideOrFail(id);

    if (override.status !== 'pending') {
      throw new BadRequestException(
        t(
          'scheduling.cancelNotPending',
          'Only pending overrides can be cancelled',
        ),
      );
    }

    const provider = await this.prisma.baseClient.provider.findFirst({
      where: { userId: currentUser.id },
      select: { id: true },
    });

    if (
      override.requestedBy !== currentUser.id &&
      override.providerId !== provider?.id
    ) {
      throw new ForbiddenException(
        t(
          'scheduling.notOwnOverride',
          'You can only cancel your own overrides',
        ),
      );
    }

    return this.prisma.baseClient.providerScheduleOverride.update({
      where: { id },
      data: { status: 'cancelled' },
      select: SCHEDULE_OVERRIDE_SELECT,
    });
  }

  private async findOverrideOrFail(id: string) {
    const override =
      await this.prisma.baseClient.providerScheduleOverride.findUnique({
        where: { id },
        select: SCHEDULE_OVERRIDE_SELECT,
      });
    if (!override) {
      throw new NotFoundException(
        t('scheduling.overrideNotFound', 'Schedule override not found'),
      );
    }
    return override;
  }
}
