import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { BulkUpdateProviderStatusDto } from './dto/bulk-update-provider-status.dto';
import { PrismaService } from '@modules/database';
import { buildPrismaQuery, buildPaginatedResponse } from '@modules/pagination';
import { t } from '@common/utils';
import type { CreateProviderDto } from './dto/create-provider.dto';
import type { UpdateProviderDto } from './dto/update-provider.dto';
import type { UpdateProviderStatusDto } from './dto/update-provider-status.dto';
import type { ProviderQueryDto } from './dto/provider-query.dto';
import type { SetProviderAppointmentTypesDto } from './dto/set-provider-appointment-types.dto';

const DOCTOR_ROLE_CODE = 'DOCTOR';

const PROVIDER_SELECT = {
  id: true,
  userId: true,
  specialty: true,
  licenseNumber: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

const PROVIDER_WITH_USER_SELECT = {
  ...PROVIDER_SELECT,
  user: {
    select: {
      id: true,
      email: true,
      fullName: true,
      phone: true,
      avatarUrl: true,
      isActive: true,
    },
  },
} as const;

@Injectable()
export class ProviderService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: ProviderQueryDto) {
    const prismaArgs = buildPrismaQuery(query, ['createdAt', 'specialty'], {
      createdAt: 'desc',
    });

    const where: Record<string, unknown> = {};
    if (query.search) {
      where.OR = [
        { specialty: { contains: query.search, mode: 'insensitive' } },
        { licenseNumber: { contains: query.search, mode: 'insensitive' } },
        {
          user: {
            fullName: { contains: query.search, mode: 'insensitive' },
          },
        },
      ];
    }
    if (query.isActive !== undefined) {
      where.isActive = query.isActive === 'true';
    }
    if (query.userId) {
      where.userId = query.userId;
    }

    const [data, total] = await Promise.all([
      this.prisma.baseClient.provider.findMany({
        ...prismaArgs,
        where,
        select: PROVIDER_WITH_USER_SELECT,
      }),
      this.prisma.baseClient.provider.count({ where }),
    ]);

    return buildPaginatedResponse(data, total, query);
  }

  async findById(id: string) {
    const provider = await this.prisma.baseClient.provider.findUnique({
      where: { id },
      select: PROVIDER_WITH_USER_SELECT,
    });
    if (!provider) {
      throw new NotFoundException(
        t('provider.not_found', 'Provider not found'),
      );
    }
    return provider;
  }

  async create(dto: CreateProviderDto) {
    const [user, hasDoctorRole] = await Promise.all([
      this.prisma.baseClient.user.findUnique({
        where: { id: dto.userId },
        select: { id: true, isActive: true },
      }),
      this.prisma.baseClient.userRole.findFirst({
        where: {
          userId: dto.userId,
          role: { code: DOCTOR_ROLE_CODE },
        },
        select: { userId: true },
      }),
    ]);

    if (!user) {
      throw new NotFoundException(t('common.user_not_found', 'User not found'));
    }
    if (!hasDoctorRole) {
      throw new BadRequestException(
        t(
          'provider.user_not_doctor',
          'User must have the Doctor role to create a provider profile',
        ),
      );
    }

    const provider = await this.prisma.baseClient.provider.create({
      data: {
        userId: dto.userId,
        specialty: dto.specialty,
        licenseNumber: dto.licenseNumber,
      },
      select: PROVIDER_WITH_USER_SELECT,
    });

    return provider;
  }

  async update(id: string, dto: UpdateProviderDto) {
    await this.findProviderOrFail(id);

    return this.prisma.baseClient.provider.update({
      where: { id },
      data: {
        specialty: dto.specialty,
        licenseNumber: dto.licenseNumber,
      },
      select: PROVIDER_WITH_USER_SELECT,
    });
  }

  async updateStatus(id: string, dto: UpdateProviderStatusDto) {
    await this.findProviderOrFail(id);

    return this.prisma.baseClient.provider.update({
      where: { id },
      data: { isActive: dto.isActive },
      select: PROVIDER_SELECT,
    });
  }

  async bulkUpdateStatus(dto: BulkUpdateProviderStatusDto) {
    return this.prisma.baseClient.provider.updateMany({
      where: { id: { in: Array.from(new Set(dto.ids)) } },
      data: { isActive: dto.isActive },
    });
  }

  async delete(id: string) {
    await this.findProviderOrFail(id);
    const [hasAppointments, hasTreatmentPlans, hasClinicalNotes] =
      await Promise.all([
        this.prisma.baseClient.appointment.findFirst({
          where: { providerId: id },
          select: { id: true },
        }),
        this.prisma.baseClient.treatmentPlan.findFirst({
          where: { providerId: id },
          select: { id: true },
        }),
        this.prisma.baseClient.clinicalNote.findFirst({
          where: { providerId: id },
          select: { id: true },
        }),
      ]);
    if (hasAppointments || hasTreatmentPlans || hasClinicalNotes) {
      throw new BadRequestException(
        t(
          'provider.has_linked_records',
          'Cannot unlink provider with existing appointments, treatment plans, or clinical notes',
        ),
      );
    }
    return this.prisma.baseClient.provider.delete({ where: { id } });
  }

  async getAppointmentTypes(id: string) {
    await this.findProviderOrFail(id);
    const rows = await this.prisma.baseClient.providerAppointmentType.findMany({
      where: { providerId: id },
      select: { appointmentTypeId: true },
    });
    return rows.map((r) => r.appointmentTypeId);
  }

  async setAppointmentTypes(id: string, dto: SetProviderAppointmentTypesDto) {
    await this.findProviderOrFail(id);

    const uniqueTypeIds = Array.from(new Set(dto.typeIds));

    await this.prisma.transaction(async (tx) => {
      await tx.providerAppointmentType.deleteMany({
        where: { providerId: id },
      });

      if (uniqueTypeIds.length > 0) {
        await tx.providerAppointmentType.createMany({
          data: uniqueTypeIds.map((typeId) => ({
            providerId: id,
            appointmentTypeId: typeId,
          })),
          skipDuplicates: true,
        });
      }
    });

    return this.getAppointmentTypes(id);
  }

  private async findProviderOrFail(id: string) {
    const provider = await this.prisma.baseClient.provider.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!provider) {
      throw new NotFoundException(
        t('provider.not_found', 'Provider not found'),
      );
    }
    return provider;
  }
}
