import {
  BCRYPT_ROUNDS,
  CACHE_DOMAIN_AUTH,
  CACHE_KEY_BLACKLIST,
  SYSTEM_ROLE_ADMIN,
} from '@common/constants';
import { activeOverrideWhere, OVERRIDE_SELECT, t } from '@common/utils';
import { PrismaService } from '@modules/database';
import { buildPaginatedResponse, buildPrismaQuery } from '@modules/pagination';
import { QueueProducerService, ROUTING_KEY } from '@modules/queue';
import { StorageService } from '@modules/storage';
import type {
  EmailSendWelcomePayload,
  EventPayload,
} from '@modules/queue/interfaces';
import { PermissionResolverService } from '@modules/rbac';
import { CacheService } from '@modules/redis';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import type { AssignRolesDto } from './dto/assign-roles.dto';
import type { CreateUserDto } from './dto/create-user.dto';
import type { UpdateUserStatusDto } from './dto/update-user-status.dto';
import type { UpdateUserDto } from './dto/update-user.dto';
import type { UserQueryDto } from './dto/user-query.dto';

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
  private readonly logger = new Logger(UserService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
    private readonly permissionResolver: PermissionResolverService,
    private readonly queueProducer: QueueProducerService,
    private readonly storageService: StorageService,
  ) {}

  private async deleteStoredAvatar(avatarUrl: string | null): Promise<void> {
    if (avatarUrl && this.storageService.isStorageKey(avatarUrl)) {
      await this.storageService
        .delete(avatarUrl)
        .catch((err) =>
          this.logger.warn(`Failed to delete old avatar: ${avatarUrl}`, err),
        );
    }
  }

  private resolveAvatarInUser<T extends { avatar_url?: string | null }>(
    user: T | null,
  ): T | null {
    if (!user) return null;
    return {
      ...user,
      avatar_url: this.storageService.resolveAvatarUrl(user.avatar_url ?? null),
    };
  }

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

    return buildPaginatedResponse(
      data.map((u) => this.resolveAvatarInUser(flattenUserRoles(u))),
      total,
      query,
    );
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

    if (!user)
      throw new NotFoundException(t('common.user_not_found', 'User not found'));

    return { ...this.resolveAvatarInUser(flattenUserRoles(user)), overrides };
  }

  private async assertCanManageAdminRole(
    roleIds: string[],
    actorUserId: string,
    requiredPermission: string,
  ): Promise<void> {
    const adminRole = await this.prisma.baseClient.role.findFirst({
      where: { name: SYSTEM_ROLE_ADMIN, id: { in: roleIds } },
      select: { id: true },
    });

    if (adminRole) {
      const canManageAdmin = await this.permissionResolver.hasPermission(
        actorUserId,
        requiredPermission,
      );
      if (!canManageAdmin) {
        throw new ForbiddenException(
          t(
            'user.cannot_manage_admin_role',
            'You do not have permission to manage the Admin role',
          ),
        );
      }
    }
  }

  async create(dto: CreateUserDto, actorUserId: string) {
    if (dto.roleIds?.length) {
      await this.assertCanManageAdminRole(
        dto.roleIds,
        actorUserId,
        'users:create:admin',
      );
    }

    const existing = await this.prisma.baseClient.user.findUnique({
      where: { email: dto.email },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(
        t('user.email_in_use', 'Email already in use'),
      );
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
    this.queueProducer.publish(
      ROUTING_KEY.EMAIL_SEND_WELCOME as string,
      welcomePayload as EventPayload,
    );

    return this.resolveAvatarInUser(flattenUserRoles(user));
  }

  async update(id: string, dto: UpdateUserDto) {
    const user = await this.prisma.baseClient.user.update({
      where: { id },
      data: {
        full_name: dto.full_name,
        phone: dto.phone,
      },
      select: USER_WITH_ROLES_SELECT,
    });

    return this.resolveAvatarInUser(flattenUserRoles(user));
  }

  async uploadAvatar(
    userId: string,
    file: Express.Multer.File,
    uploadedBy: string,
  ) {
    const user = await this.prisma.baseClient.user.findUnique({
      where: { id: userId },
      select: { avatar_url: true },
    });
    if (!user)
      throw new NotFoundException(t('common.user_not_found', 'User not found'));

    const processed = await this.storageService.processAvatar(file.buffer);

    const { key } = await this.storageService.upload(processed, {
      category: 'avatars',
      entityId: userId,
      originalFilename: 'avatar.webp',
      contentType: 'image/webp',
      uploadedBy,
    });

    await this.deleteStoredAvatar(user.avatar_url);

    await this.prisma.baseClient.user.update({
      where: { id: userId },
      data: { avatar_url: key },
    });

    return { id: userId, avatarUrl: this.storageService.getPublicUrl(key) };
  }

  async removeAvatar(userId: string) {
    const user = await this.prisma.baseClient.user.findUnique({
      where: { id: userId },
      select: { avatar_url: true },
    });
    if (!user)
      throw new NotFoundException(t('common.user_not_found', 'User not found'));

    await this.deleteStoredAvatar(user.avatar_url);

    await this.prisma.baseClient.user.update({
      where: { id: userId },
      data: { avatar_url: null },
    });

    return { id: userId, message: t('user.avatar_removed', 'Avatar removed') };
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

  async assignRoles(id: string, dto: AssignRolesDto, actorUserId: string) {
    const existingRoles = await this.prisma.baseClient.role.findMany({
      where: { id: { in: dto.roleIds } },
      select: { id: true, name: true },
    });
    if (existingRoles.length !== dto.roleIds.length) {
      throw new BadRequestException(
        t('user.invalid_role_ids', 'One or more role IDs are invalid'),
      );
    }

    if (existingRoles.some((r) => r.name === SYSTEM_ROLE_ADMIN)) {
      const canManageAdmin = await this.permissionResolver.hasPermission(
        actorUserId,
        'users:update:admin',
      );
      if (!canManageAdmin) {
        throw new ForbiddenException(
          t(
            'user.cannot_manage_admin_role',
            'You do not have permission to manage the Admin role',
          ),
        );
      }
    }

    await this.prisma.baseClient.userRole.createMany({
      data: dto.roleIds.map((roleId) => ({
        user_id: id,
        role_id: roleId,
      })),
      skipDuplicates: true,
    });

    await this.permissionResolver.invalidateCache(id);

    return { message: t('user.roles_assigned', 'Roles assigned') };
  }

  async removeRoles(id: string, dto: AssignRolesDto, actorUserId: string) {
    await this.assertCanManageAdminRole(
      dto.roleIds,
      actorUserId,
      'users:update:admin',
    );

    await this.prisma.baseClient.userRole.deleteMany({
      where: {
        user_id: id,
        role_id: { in: dto.roleIds },
      },
    });

    await this.permissionResolver.invalidateCache(id);

    return { message: t('user.roles_removed', 'Roles removed') };
  }

  async updateLanguage(userId: string, language: string) {
    await this.prisma.client.user.update({
      where: { id: userId },
      data: { preferred_language: language },
    });
    return {
      message: t('user.language_updated', 'Language preference updated'),
    };
  }
}
