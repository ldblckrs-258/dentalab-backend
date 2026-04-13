import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@modules/database';
import { buildPrismaQuery, buildPaginatedResponse } from '@modules/pagination';
import { t } from '@common/utils';
import type { CreateProviderDto } from './dto/create-provider.dto';
import type { UpdateProviderDto } from './dto/update-provider.dto';
import type { UpdateProviderStatusDto } from './dto/update-provider-status.dto';
import type { ProviderQueryDto } from './dto/provider-query.dto';

const SYSTEM_ROLE_DOCTOR = 'Doctor';

const PROVIDER_SELECT = {
  id: true,
  user_id: true,
  specialty: true,
  license_number: true,
  is_active: true,
  created_at: true,
  updated_at: true,
} as const;

const PROVIDER_WITH_USER_SELECT = {
  ...PROVIDER_SELECT,
  user: {
    select: {
      id: true,
      email: true,
      full_name: true,
      phone: true,
      avatar_url: true,
      is_active: true,
    },
  },
} as const;

@Injectable()
export class ProviderService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: ProviderQueryDto) {
    const prismaArgs = buildPrismaQuery(query, ['created_at', 'specialty'], {
      created_at: 'desc',
    });

    const where: Record<string, unknown> = {};
    if (query.search) {
      where.OR = [
        { specialty: { contains: query.search, mode: 'insensitive' } },
        { license_number: { contains: query.search, mode: 'insensitive' } },
        {
          user: {
            full_name: { contains: query.search, mode: 'insensitive' },
          },
        },
      ];
    }
    if (query.isActive !== undefined) {
      where.is_active = query.isActive === 'true';
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
        select: { id: true, is_active: true },
      }),
      this.prisma.baseClient.userRole.findFirst({
        where: {
          user_id: dto.userId,
          role: { name: SYSTEM_ROLE_DOCTOR },
        },
        select: { user_id: true },
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
        user_id: dto.userId,
        specialty: dto.specialty,
        license_number: dto.license_number,
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
        license_number: dto.license_number,
      },
      select: PROVIDER_WITH_USER_SELECT,
    });
  }

  async updateStatus(id: string, dto: UpdateProviderStatusDto) {
    await this.findProviderOrFail(id);

    return this.prisma.baseClient.provider.update({
      where: { id },
      data: { is_active: dto.is_active },
      select: PROVIDER_SELECT,
    });
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
