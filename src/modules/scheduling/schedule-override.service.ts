import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@modules/database';
import { AuditService } from '@modules/audit';
import { buildPrismaQuery, buildPaginatedResponse } from '@modules/pagination';
import { AppConfigService } from '@modules/config';
import { t } from '@common/utils';
import type { AuthenticatedUser } from '@common/interfaces';
import {
  SchedulingConflictService,
  serializeConflicts,
} from './scheduling-conflict.service';
import { SchedulingGateway } from './scheduling.gateway';
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
  targetScheduleId: true,
} as const;

@Injectable()
export class ScheduleOverrideService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly config: AppConfigService,
    private readonly conflictService: SchedulingConflictService,
    private readonly schedulingGateway: SchedulingGateway,
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
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const specificDate = new Date(dto.specificDate);
    specificDate.setUTCHours(0, 0, 0, 0);

    if (specificDate <= today) {
      throw new BadRequestException(
        t(
          'scheduling.cannotCreatePastOverride',
          'Cannot create an override for today or a past date',
        ),
      );
    }

    const userProvider = await this.prisma.baseClient.provider.findFirst({
      where: { userId: currentUser.id },
      select: { id: true },
    });
    if (userProvider && userProvider.id !== dto.providerId) {
      throw new ForbiddenException(
        t('scheduling.notOwnProvider', 'Provider does not belong to you'),
      );
    }

    if (dto.targetScheduleId) {
      const shift =
        await this.prisma.baseClient.providerSchedule.findUnique({
          where: { id: dto.targetScheduleId },
          select: { id: true, providerId: true, dayOfWeek: true, isAvailable: true },
        });
      const computedDow = new Date(dto.specificDate).getUTCDay();
      if (
        !shift ||
        shift.providerId !== dto.providerId ||
        shift.dayOfWeek !== computedDow ||
        !shift.isAvailable
      ) {
        throw new BadRequestException(
          t(
            'scheduling.targetShiftMismatch',
            'Target shift does not match override (provider, day-of-week, or active state)',
          ),
        );
      }
    }

    const created =
      await this.prisma.baseClient.providerScheduleOverride.create({
        data: {
          providerId: dto.providerId,
          requestedBy: currentUser.id,
          specificDate: dto.specificDate,
          overrideType: dto.overrideType,
          startTime:
            dto.overrideType === 'custom_hours'
              ? (dto.startTime ?? null)
              : null,
          endTime:
            dto.overrideType === 'custom_hours' ? (dto.endTime ?? null) : null,
          reason: dto.reason,
          status: 'pending',
          requestedAt: new Date(),
          targetScheduleId: dto.targetScheduleId ?? null,
        },
        select: SCHEDULE_OVERRIDE_SELECT,
      });

    this.schedulingGateway.emitOverrideRequested({
      id: created.id,
      providerId: created.providerId,
      specificDate: created.specificDate.toISOString(),
    });

    return created;
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

    const withStale = this.addStaleFlag(data);
    return buildPaginatedResponse(withStale, total, query);
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

    const withStale = this.addStaleFlag(data);
    return buildPaginatedResponse(withStale, total, query);
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

    const withStale = this.addStaleFlag(data);
    return buildPaginatedResponse(withStale, total, query);
  }

  async review(
    id: string,
    dto: ReviewScheduleOverrideDto,
    currentUser: AuthenticatedUser,
  ) {
    const override = await this.findOverrideOrFail(id);
    const newStatus = dto.decision === 'approve' ? 'approved' : 'rejected';

    await this.prisma.transaction(async (tx) => {
      // Spec §2.3: approving an override that conflicts with existing
      // appointments must block — validate before mutating.
      if (dto.decision === 'approve') {
        const conflicts = await this.conflictService.validateOverrideApproval(
          override.providerId,
          new Date(override.specificDate),
          override.overrideType,
          override.startTime,
          override.endTime,
          tx,
          override.targetScheduleId ?? null,
        );

        if (conflicts.length > 0) {
          throw new ConflictException({
            code: 'OVERRIDE_HAS_CONFLICTS',
            message: t(
              'scheduling.overrideConflicts',
              'Schedule override has conflicting appointments',
            ),
            conflicts: serializeConflicts(conflicts),
          });
        }
      }

      await tx.providerScheduleOverride.update({
        where: { id },
        data: {
          status: newStatus,
          reviewedBy: currentUser.id,
          reviewedAt: new Date(),
          ...(dto.reviewNote !== undefined && { reviewNote: dto.reviewNote }),
        },
      });
    });

    this.auditService.emit({
      code:
        dto.decision === 'approve'
          ? 'SCHEDULE_OVERRIDE_APPROVED'
          : 'SCHEDULE_OVERRIDE_REJECTED',
      resource: 'schedule_override',
      resourceId: id,
    });

    this.schedulingGateway.emitOverrideReviewed({
      id,
      status: newStatus,
      reviewerId: currentUser.id,
    });

    return { id, status: newStatus };
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

    const cancelled =
      await this.prisma.baseClient.providerScheduleOverride.update({
        where: { id },
        data: { status: 'cancelled' },
        select: SCHEDULE_OVERRIDE_SELECT,
      });

    this.schedulingGateway.emitOverrideReviewed({
      id,
      status: 'cancelled',
      reviewerId: null,
    });

    return cancelled;
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

  private addStaleFlag<
    T extends {
      status: string;
      requestedAt: Date;
    },
  >(overrides: readonly T[]): Array<T & { isStale: boolean }> {
    const staleDays = this.config.app.SCHEDULE_OVERRIDE_STALE_DAYS;
    const staleThreshold = new Date();
    staleThreshold.setUTCDate(staleThreshold.getUTCDate() - staleDays);

    return overrides.map((o) => ({
      ...o,
      isStale: o.status === 'pending' && o.requestedAt < staleThreshold,
    }));
  }
}
