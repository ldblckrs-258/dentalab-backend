import { t } from '@common/utils';
import { PrismaService } from '@modules/database';
import { buildPaginatedResponse, buildPrismaQuery } from '@modules/pagination';
import { CacheService, REDIS_NAMESPACE } from '@modules/redis';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import stableStringify from 'fast-json-stable-stringify';
import type { AppointmentTypeQueryDto } from './dto/appointment-type-query.dto';
import type { CreateAppointmentTypeDto } from './dto/create-appointment-type.dto';
import type { UpdateAppointmentTypeDto } from './dto/update-appointment-type.dto';

const SELECT = {
  id: true,
  name: true,
  durationMinutes: true,
  color: true,
  textColor: true,
  isActive: true,
  createdBy: true,
  updatedBy: true,
  createdAt: true,
  updatedAt: true,
} as const;

const CACHE_DOMAIN = 'appointment-types';
const CACHE_TTL_SECONDS = 300;

@Injectable()
export class AppointmentTypeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
  ) {}

  async findAll(query: AppointmentTypeQueryDto) {
    const cacheKey = `list:${stableStringify(query)}`;
    const cached = await this.cacheService.get<
      Awaited<ReturnType<typeof this.findAll>>
    >(CACHE_DOMAIN, cacheKey);
    if (cached) return cached;

    const prismaArgs = buildPrismaQuery(
      query,
      ['name', 'durationMinutes', 'createdAt'],
      { name: 'asc' },
    );

    const where: Record<string, unknown> = {};
    if (query.isActive !== undefined) {
      where.isActive = query.isActive;
    }
    if (query.search) {
      where.OR = [{ name: { contains: query.search, mode: 'insensitive' } }];
    }

    const [data, total] = await Promise.all([
      this.prisma.baseClient.appointmentType.findMany({
        ...prismaArgs,
        where,
        select: SELECT,
      }),
      this.prisma.baseClient.appointmentType.count({ where }),
    ]);

    const response = buildPaginatedResponse(data, total, query);
    await this.cacheService.set(
      CACHE_DOMAIN,
      cacheKey,
      response,
      CACHE_TTL_SECONDS,
    );
    return response;
  }

  async findById(id: string) {
    const cacheKey = `detail:${id}`;
    const cached = await this.cacheService.get<
      Awaited<ReturnType<typeof this.findById>>
    >(CACHE_DOMAIN, cacheKey);
    if (cached) return cached;

    const record = await this.prisma.baseClient.appointmentType.findUnique({
      where: { id },
      select: SELECT,
    });
    if (!record) {
      throw new NotFoundException(
        t('appointment_type.not_found', 'Appointment type not found'),
      );
    }
    await this.cacheService.set(
      CACHE_DOMAIN,
      cacheKey,
      record,
      CACHE_TTL_SECONDS,
    );
    return record;
  }

  async create(dto: CreateAppointmentTypeDto, userId: string) {
    await this.assertNameUnique(dto.name);

    const created = await this.prisma.baseClient.appointmentType.create({
      data: {
        name: dto.name,
        durationMinutes: dto.durationMinutes,
        color: dto.color,
        textColor: dto.textColor,
        createdBy: userId,
        updatedBy: userId,
      },
      select: SELECT,
    });
    await this.invalidateCache();
    return created;
  }

  async update(id: string, dto: UpdateAppointmentTypeDto, userId: string) {
    const current = await this.findOrFail(id);

    if (dto.name !== undefined && dto.name !== current.name) {
      await this.assertNameUnique(dto.name);
    }

    const updated = await this.prisma.baseClient.appointmentType.update({
      where: { id },
      data: {
        name: dto.name,
        durationMinutes: dto.durationMinutes,
        color: dto.color,
        textColor: dto.textColor,
        isActive: dto.isActive,
        updatedBy: userId,
      },
      select: SELECT,
    });
    await this.invalidateCache();
    return updated;
  }

  async deactivate(id: string, userId: string) {
    const current = await this.findOrFail(id);

    if (!current.isActive) {
      throw new ConflictException(
        t(
          'appointment_type.already_inactive',
          'Appointment type is already inactive',
        ),
      );
    }

    const updated = await this.prisma.baseClient.appointmentType.update({
      where: { id },
      data: { isActive: false, updatedBy: userId },
      select: SELECT,
    });
    await this.invalidateCache();
    return updated;
  }

  private async invalidateCache() {
    await this.cacheService.invalidatePattern(
      `${REDIS_NAMESPACE}:${CACHE_DOMAIN}:*`,
    );
  }

  private async assertNameUnique(name: string) {
    const existing = await this.prisma.baseClient.appointmentType.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        isActive: true,
      },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(
        t(
          'appointment_type.duplicate_name',
          'An active appointment type with this name already exists',
        ),
      );
    }
  }

  private async findOrFail(id: string) {
    const record = await this.prisma.baseClient.appointmentType.findUnique({
      where: { id },
      select: { id: true, name: true, isActive: true },
    });
    if (!record) {
      throw new NotFoundException(
        t('appointment_type.not_found', 'Appointment type not found'),
      );
    }
    return record;
  }
}
