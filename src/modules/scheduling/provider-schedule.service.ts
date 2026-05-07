import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@modules/database';
import { buildPrismaQuery, buildPaginatedResponse } from '@modules/pagination';
import { t } from '@common/utils';
import { InfrastructureException } from '@modules/common/filters/infrastructure.exception';
import type { CreateProviderScheduleDto } from './dto/create-provider-schedule.dto';
import type { UpdateProviderScheduleDto } from './dto/update-provider-schedule.dto';
import type { ProviderScheduleQueryDto } from './dto/provider-schedule-query.dto';

export const PROVIDER_SCHEDULE_SELECT = {
  id: true,
  providerId: true,
  dayOfWeek: true,
  startTime: true,
  endTime: true,
  isAvailable: true,
} as const;

@Injectable()
export class ProviderScheduleService {
  constructor(private readonly prisma: PrismaService) {}

  async findForProvider(providerId: string, onlyAvailable?: boolean) {
    const where: Record<string, unknown> = { providerId };
    if (onlyAvailable) {
      where.isAvailable = true;
    }

    return this.prisma.baseClient.providerSchedule.findMany({
      where,
      select: PROVIDER_SCHEDULE_SELECT,
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    });
  }

  async findAll(query: ProviderScheduleQueryDto) {
    const prismaArgs = buildPrismaQuery(query, ['dayOfWeek', 'startTime'], {
      dayOfWeek: 'asc',
    });

    const where: Record<string, unknown> = {};
    if (query.providerId) {
      where.providerId = query.providerId;
    }
    if (query.dayOfWeek !== undefined) {
      where.dayOfWeek = query.dayOfWeek;
    }
    if (query.onlyAvailable) {
      where.isAvailable = true;
    }

    const [data, total] = await Promise.all([
      this.prisma.baseClient.providerSchedule.findMany({
        ...prismaArgs,
        where,
        select: PROVIDER_SCHEDULE_SELECT,
      }),
      this.prisma.baseClient.providerSchedule.count({ where }),
    ]);

    return buildPaginatedResponse(data, total, query);
  }

  async create(dto: CreateProviderScheduleDto) {
    if (dto.endTime <= dto.startTime) {
      throw new InfrastructureException(
        'SCHEDULE_INVALID_TIME_RANGE',
        'scheduling',
        'validateTimeRange',
        t('scheduling.invalidTimeRange', 'End time must be after start time'),
      );
    }

    await this.validateProvider(dto.providerId);

    try {
      return await this.prisma.baseClient.providerSchedule.create({
        data: {
          providerId: dto.providerId,
          dayOfWeek: dto.dayOfWeek,
          startTime: dto.startTime,
          endTime: dto.endTime,
          isAvailable: dto.isAvailable ?? true,
        },
        select: PROVIDER_SCHEDULE_SELECT,
      });
    } catch (error: unknown) {
      if (this.isOverlapError(error)) {
        throw new InfrastructureException(
          'SCHEDULE_OVERLAP',
          'scheduling',
          'createProviderSchedule',
          t(
            'scheduling.scheduleOverlap',
            'Schedule time block overlaps with an existing block',
          ),
        );
      }
      throw error;
    }
  }

  async update(id: string, dto: UpdateProviderScheduleDto) {
    await this.findScheduleOrFail(id);

    if (dto.endTime && dto.startTime && dto.endTime <= dto.startTime) {
      throw new InfrastructureException(
        'SCHEDULE_INVALID_TIME_RANGE',
        'scheduling',
        'validateTimeRange',
        t('scheduling.invalidTimeRange', 'End time must be after start time'),
      );
    }

    if (dto.providerId) {
      await this.validateProvider(dto.providerId);
    }

    try {
      return await this.prisma.baseClient.providerSchedule.update({
        where: { id },
        data: {
          ...(dto.providerId !== undefined && { providerId: dto.providerId }),
          ...(dto.dayOfWeek !== undefined && { dayOfWeek: dto.dayOfWeek }),
          ...(dto.startTime !== undefined && { startTime: dto.startTime }),
          ...(dto.endTime !== undefined && { endTime: dto.endTime }),
          ...(dto.isAvailable !== undefined && {
            isAvailable: dto.isAvailable,
          }),
        },
        select: PROVIDER_SCHEDULE_SELECT,
      });
    } catch (error: unknown) {
      if (this.isOverlapError(error)) {
        throw new InfrastructureException(
          'SCHEDULE_OVERLAP',
          'scheduling',
          'updateProviderSchedule',
          t(
            'scheduling.scheduleOverlap',
            'Schedule time block overlaps with an existing block',
          ),
        );
      }
      throw error;
    }
  }

  async delete(id: string) {
    const schedule = await this.findScheduleOrFail(id);

    const affectedAppointments =
      await this.prisma.baseClient.appointment.findMany({
        where: {
          providerId: schedule.providerId,
          status: { notIn: ['cancelled'] },
          startTime: { gte: new Date() },
        },
        select: { id: true, startTime: true, status: true },
      });

    await this.prisma.baseClient.providerSchedule.delete({ where: { id } });

    return {
      deleted: true,
      affectedAppointments,
    };
  }

  private async validateProvider(providerId: string) {
    const provider = await this.prisma.baseClient.provider.findUnique({
      where: { id: providerId },
      select: { id: true, isActive: true },
    });

    if (!provider) {
      throw new NotFoundException(
        t('provider.not_found', 'Provider not found'),
      );
    }

    if (!provider.isActive) {
      throw new InfrastructureException(
        'SCHEDULE_PROVIDER_NOT_ACTIVE',
        'scheduling',
        'validateProvider',
        t('scheduling.providerNotActive', 'Provider is not active'),
      );
    }
  }

  private isOverlapError(error: unknown): boolean {
    return (
      error !== null &&
      typeof error === 'object' &&
      'code' in error &&
      ((error as { code: string }).code === 'P2009' ||
        (error as { code: string }).code === 'P2010')
    );
  }

  private async findScheduleOrFail(id: string) {
    const schedule = await this.prisma.baseClient.providerSchedule.findUnique({
      where: { id },
      select: { id: true, providerId: true, dayOfWeek: true },
    });
    if (!schedule) {
      throw new NotFoundException(
        t('scheduling.scheduleNotFound', 'Schedule not found'),
      );
    }
    return schedule;
  }
}
