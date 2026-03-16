import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '@modules/database';
import { CacheService } from '@modules/redis';
import { QueueProducerService, ROUTING_KEY } from '@modules/queue';
import type { EmailSendWelcomePayload } from '@modules/queue/interfaces';
import { buildPrismaQuery, buildPaginatedResponse } from '@modules/pagination';
import { PermissionResolverService } from '@modules/rbac';
import {
  BCRYPT_ROUNDS,
  CACHE_DOMAIN_AUTH,
  CACHE_KEY_BLACKLIST,
} from '@common/constants';
import { activeOverrideWhere, OVERRIDE_SELECT } from '@common/utils';
import type { UserQueryDto } from './dto/user-query.dto';
import type { CreateUserDto } from './dto/create-user.dto';
import type { UpdateUserDto } from './dto/update-user.dto';
import type { UpdateUserStatusDto } from './dto/update-user-status.dto';
import type { AssignRolesDto } from './dto/assign-roles.dto';

const USER_SELECT = {
  id: true,
  email: true,
  full_name: true,
  phone: true,
  avatar_url: true,
  is_active: true,
  created_at: true,
  updated_at: true,
} as const;

const USER_WITH_ROLES_SELECT = {
  ...USER_SELECT,
  user_roles: {
    select: { role: { select: { id: true, name: true } } },
  },
} as const;

function flattenUserRoles<T extends { user_roles: { role: unknown }[] }>(
  user: T | null,
) {
  if (!user) return null;
  const { user_roles, ...rest } = user;
  return { ...rest, roles: user_roles.map((ur) => ur.role) };
}

@Injectable()
export class UserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
    private readonly permissionResolver: PermissionResolverService,
    private readonly queueProducer: QueueProducerService,
  ) {}

  async findAll(query: UserQueryDto) {
    const prismaArgs = buildPrismaQuery(query, [
      'full_name',
      'email',
      'created_at',
    ]);

    const where: Record<string, unknown> = {};
    if (query.search) {
      where.OR = [
        { full_name: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.roleId) {
      where.user_roles = { some: { role_id: query.roleId } };
    }
    if (query.isActive !== undefined) {
      where.is_active = query.isActive === 'true';
    }

    const [data, total] = await Promise.all([
      this.prisma.baseClient.user.findMany({
        ...prismaArgs,
        where,
        select: USER_WITH_ROLES_SELECT,
      }),
      this.prisma.baseClient.user.count({ where }),
    ]);

    return buildPaginatedResponse(data.map(flattenUserRoles), total, query);
  }

  async findById(id: string) {
    const [user, overrides] = await Promise.all([
      this.prisma.baseClient.user.findUnique({
        where: { id },
        select: USER_WITH_ROLES_SELECT,
      }),
      this.prisma.baseClient.userPermissionOverride.findMany({
        where: activeOverrideWhere(id),
        select: OVERRIDE_SELECT,
        orderBy: { created_at: 'desc' },
      }),
    ]);

    if (!user) throw new NotFoundException('User not found');

    return { ...flattenUserRoles(user), overrides };
  }

  async create(dto: CreateUserDto) {
    const existing = await this.prisma.baseClient.user.findUnique({
      where: { email: dto.email },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('Email already in use');
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    const user = await this.prisma.transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: dto.email,
          full_name: dto.full_name,
          phone: dto.phone,
          password_hash: passwordHash,
        },
      });

      if (dto.roleIds?.length) {
        await tx.userRole.createMany({
          data: dto.roleIds.map((roleId) => ({
            user_id: created.id,
            role_id: roleId,
          })),
          skipDuplicates: true,
        });
      }

      return tx.user.findUnique({
        where: { id: created.id },
        select: USER_WITH_ROLES_SELECT,
      });
    });

    // Publish welcome email event
    const welcomePayload: EmailSendWelcomePayload = {
      userId: user!.id,
      email: dto.email,
      fullName: dto.full_name,
      temporaryPassword: dto.password,
    };
    this.queueProducer.publish(ROUTING_KEY.EMAIL_SEND_WELCOME, welcomePayload);

    return flattenUserRoles(user);
  }

  async update(id: string, dto: UpdateUserDto) {
    const user = await this.prisma.baseClient.user.update({
      where: { id },
      data: {
        full_name: dto.full_name,
        phone: dto.phone,
        avatar_url: dto.avatar_url,
      },
      select: USER_WITH_ROLES_SELECT,
    });

    return flattenUserRoles(user);
  }

  async updateStatus(id: string, dto: UpdateUserStatusDto) {
    const updated = await this.prisma.baseClient.user.update({
      where: { id },
      data: { is_active: dto.is_active },
      select: USER_SELECT,
    });

    // Side-effects when deactivating
    if (!dto.is_active) {
      const tokens = await this.prisma.baseClient.refreshToken.findMany({
        where: { user_id: id },
        select: { token_hash: true, expires_at: true },
      });

      // Blacklist all refresh tokens and invalidate permission cache
      await Promise.all([
        this.permissionResolver.invalidateCache(id),
        ...tokens.map((t) => {
          const remainingTtl = Math.ceil(
            (t.expires_at.getTime() - Date.now()) / 1000,
          );
          return remainingTtl > 0
            ? this.cacheService.set(
                CACHE_DOMAIN_AUTH,
                `${CACHE_KEY_BLACKLIST}:${t.token_hash}`,
                true,
                remainingTtl,
              )
            : Promise.resolve();
        }),
        this.prisma.baseClient.refreshToken.deleteMany({
          where: { user_id: id },
        }),
      ]);
    }

    return updated;
  }

  async assignRoles(id: string, dto: AssignRolesDto) {
    const existingRoles = await this.prisma.baseClient.role.findMany({
      where: { id: { in: dto.roleIds } },
      select: { id: true },
    });
    if (existingRoles.length !== dto.roleIds.length) {
      throw new BadRequestException('One or more role IDs are invalid');
    }

    await this.prisma.baseClient.userRole.createMany({
      data: dto.roleIds.map((roleId) => ({
        user_id: id,
        role_id: roleId,
      })),
      skipDuplicates: true,
    });

    await this.permissionResolver.invalidateCache(id);

    return { message: 'Roles assigned' };
  }

  async removeRoles(id: string, dto: AssignRolesDto) {
    await this.prisma.baseClient.userRole.deleteMany({
      where: {
        user_id: id,
        role_id: { in: dto.roleIds },
      },
    });

    await this.permissionResolver.invalidateCache(id);

    return { message: 'Roles removed' };
  }
}
