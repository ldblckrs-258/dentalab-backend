import { t, operatoryOccupancyWhere } from '@common/utils';
import { NON_CONFLICTING_APPOINTMENT_STATUSES } from '@common/constants/app.constants';
import { PrismaService } from '@modules/database';
import { buildPaginatedResponse, buildPrismaQuery } from '@modules/pagination';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { CreateOperatoryDto } from './dto/create-operatory.dto';
import type { OperatoryQueryDto } from './dto/operatory-query.dto';
import type { ReorderOperatoriesDto } from './dto/reorder-operatories.dto';
import type { UpdateOperatoryDto } from './dto/update-operatory.dto';

const SELECT = {
  id: true,
  name: true,
  code: true,
  color: true,
  isActive: true,
  displayOrder: true,
  createdAt: true,
  updatedAt: true,
} as const;

// Deactivation guard also ignores completed appointments — a finished visit in
// a room never blocks retiring that room.
const NON_BLOCKING_STATUS = [
  ...NON_CONFLICTING_APPOINTMENT_STATUSES,
  'completed',
];

// Stable advisory-lock namespace serializing displayOrder allocation across
// concurrent creates. READ COMMITTED would otherwise let two creates read the
// same max before either commits; the lock releases at transaction end.
const OPERATORY_ORDER_LOCK = 482371000;

@Injectable()
export class OperatoryService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: OperatoryQueryDto) {
    const prismaArgs = buildPrismaQuery(
      query,
      ['name', 'code', 'displayOrder', 'createdAt'],
      { displayOrder: 'asc' },
    );

    const where: Record<string, unknown> = {};
    if (query.isActive !== undefined) {
      where.isActive = query.isActive;
    }
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { code: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.baseClient.operatory.findMany({
        ...prismaArgs,
        where,
        select: SELECT,
      }),
      this.prisma.baseClient.operatory.count({ where }),
    ]);

    return buildPaginatedResponse(data, total, query);
  }

  async findById(id: string) {
    const record = await this.prisma.baseClient.operatory.findUnique({
      where: { id },
      select: SELECT,
    });
    if (!record) {
      throw new NotFoundException(
        t('operatory.not_found', 'Operatory not found'),
      );
    }
    return record;
  }

  async create(dto: CreateOperatoryDto) {
    await this.assertCodeUnique(dto.code);

    return this.prisma.baseClient.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${OPERATORY_ORDER_LOCK}::bigint)`;

      const max = await tx.operatory.aggregate({
        where: { isActive: true },
        _max: { displayOrder: true },
      });
      const nextOrder = (max._max.displayOrder ?? -1) + 1;

      return tx.operatory.create({
        data: {
          name: dto.name,
          code: dto.code,
          color: dto.color,
          displayOrder: nextOrder,
        },
        select: SELECT,
      });
    });
  }

  async update(id: string, dto: UpdateOperatoryDto) {
    const current = await this.findOrFail(id);

    if (dto.code !== undefined && dto.code !== current.code) {
      await this.assertCodeUnique(dto.code);
    }

    return this.prisma.baseClient.operatory.update({
      where: { id },
      data: {
        name: dto.name,
        code: dto.code,
        color: dto.color,
        isActive: dto.isActive,
      },
      select: SELECT,
    });
  }

  async deactivate(id: string) {
    const current = await this.findOrFail(id);

    if (!current.isActive) {
      throw new ConflictException(
        t('operatory.already_inactive', 'Operatory is already inactive'),
      );
    }

    const futureCount = await this.prisma.baseClient.appointment.count({
      where: {
        operatoryId: id,
        startTime: { gte: new Date() },
        status: { notIn: NON_BLOCKING_STATUS },
      },
    });
    if (futureCount > 0) {
      throw new ConflictException({
        code: 'OPERATORY_HAS_FUTURE_APPOINTMENTS',
        message: t(
          'operatory.has_future_appointments',
          'Operatory has upcoming appointments; reassign or cancel them before deactivating',
        ),
        futureAppointmentCount: futureCount,
      });
    }

    return this.prisma.baseClient.operatory.update({
      where: { id },
      data: { isActive: false },
      select: SELECT,
    });
  }

  async reorder(dto: ReorderOperatoriesDto) {
    const all = await this.prisma.baseClient.operatory.findMany({
      where: { isActive: true },
      select: { id: true },
    });
    const allIds = new Set(all.map((o) => o.id));
    const inputIds = new Set(dto.orderedIds);

    if (
      inputIds.size !== dto.orderedIds.length ||
      inputIds.size !== allIds.size ||
      ![...inputIds].every((id) => allIds.has(id))
    ) {
      throw new BadRequestException(
        t(
          'operatory.reorder_must_be_complete',
          'Reorder must include every operatory id exactly once',
        ),
      );
    }

    await this.prisma.baseClient.$transaction(
      dto.orderedIds.map((id, index) =>
        this.prisma.baseClient.operatory.update({
          where: { id },
          data: { displayOrder: index },
        }),
      ),
    );

    return this.prisma.baseClient.operatory.findMany({
      where: { isActive: true },
      orderBy: { displayOrder: 'asc' },
      select: SELECT,
    });
  }

  async getBusyOperatoryIds(
    start: Date,
    end: Date,
    excludeAppointmentId?: string,
  ): Promise<string[]> {
    const rows = await this.prisma.baseClient.appointment.findMany({
      where: operatoryOccupancyWhere(start, end, excludeAppointmentId),
      select: { operatoryId: true },
      distinct: ['operatoryId'],
    });
    return rows
      .map((r) => r.operatoryId)
      .filter((id): id is string => id !== null);
  }

  private async assertCodeUnique(code: string) {
    const existing = await this.prisma.baseClient.operatory.findFirst({
      where: { code: { equals: code, mode: 'insensitive' } },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(
        t(
          'operatory.duplicate_code',
          'An operatory with this code already exists',
        ),
      );
    }
  }

  private async findOrFail(id: string) {
    const record = await this.prisma.baseClient.operatory.findUnique({
      where: { id },
      select: { id: true, code: true, isActive: true },
    });
    if (!record) {
      throw new NotFoundException(
        t('operatory.not_found', 'Operatory not found'),
      );
    }
    return record;
  }
}
