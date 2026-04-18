import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@modules/database';
import {
  PaginationQueryDto,
  buildPrismaQuery,
  buildPaginatedResponse,
} from '@modules/pagination';
import { activeOverrideWhere, OVERRIDE_SELECT, t } from '@common/utils';
import { PermissionResolverService } from './services/permission-resolver.service';
import type { CreateRoleDto } from './dto/create-role.dto';
import type { UpdateRoleDto } from './dto/update-role.dto';
import type { AssignPermissionsDto } from './dto/assign-permissions.dto';
import type { CreateOverrideDto } from './dto/create-override.dto';

@Injectable()
export class RbacService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissionResolver: PermissionResolverService,
  ) {}

  // ── Roles ──

  async findAllRoles(query: PaginationQueryDto) {
    const prismaArgs = buildPrismaQuery(query, ['name', 'createdAt']);
    const [rawData, total] = await Promise.all([
      this.prisma.baseClient.role.findMany({
        ...prismaArgs,
        include: {
          _count: { select: { userRoles: true, rolePermissions: true } },
        },
      }),
      this.prisma.baseClient.role.count(),
    ]);

    const data = rawData.map(({ _count, ...rest }) => ({
      ...rest,
      userCount: _count.userRoles,
      permissionCount: _count.rolePermissions,
    }));

    return buildPaginatedResponse(data, total, query);
  }

  async findRoleById(id: string) {
    const role = await this.prisma.baseClient.role.findUnique({
      where: { id },
      include: {
        rolePermissions: {
          select: {
            permission: {
              select: {
                id: true,
                resource: true,
                action: true,
                description: true,
              },
            },
          },
        },
        _count: { select: { userRoles: true, rolePermissions: true } },
      },
    });
    if (!role)
      throw new NotFoundException(t('rbac.role_not_found', 'Role not found'));

    const { rolePermissions, _count, ...rest } = role;
    return {
      ...rest,
      permissions: rolePermissions.map((rp) => rp.permission),
      userCount: _count.userRoles,
      permissionCount: _count.rolePermissions,
    };
  }

  async createRole(dto: CreateRoleDto) {
    return this.prisma.baseClient.role.create({
      data: {
        name: dto.name,
        description: dto.description,
        isSystem: false,
      },
    });
  }

  async updateRole(id: string, dto: UpdateRoleDto) {
    const role = await this.prisma.baseClient.role.findUnique({
      where: { id },
    });
    if (!role)
      throw new NotFoundException(t('rbac.role_not_found', 'Role not found'));

    // System roles: only description can be changed
    if (role.isSystem && dto.name && dto.name !== role.name) {
      throw new ForbiddenException(
        t('rbac.cannot_rename_system_role', 'Cannot rename a system role'),
      );
    }

    return this.prisma.baseClient.role.update({
      where: { id },
      data: {
        name: role.isSystem ? undefined : dto.name,
        description: dto.description,
      },
    });
  }

  async deleteRole(id: string) {
    const role = await this.prisma.baseClient.role.findUnique({
      where: { id },
      include: { _count: { select: { userRoles: true } } },
    });
    if (!role)
      throw new NotFoundException(t('rbac.role_not_found', 'Role not found'));
    if (role.isSystem) {
      throw new ForbiddenException(
        t('rbac.cannot_delete_system_role', 'Cannot delete a system role'),
      );
    }
    if (role._count.userRoles > 0) {
      throw new BadRequestException(
        t(
          'rbac.cannot_delete_role_with_users',
          'Cannot delete role with assigned users. Remove users from this role first.',
        ),
      );
    }

    await this.prisma.baseClient.role.delete({ where: { id } });
    return {
      message: t('rbac.role_deleted', 'Role deleted'),
    };
  }

  // ── Permissions ──

  async findAllPermissions(query: PaginationQueryDto) {
    const prismaArgs = buildPrismaQuery(query, ['resource', 'action'], {
      resource: 'asc',
    });

    const where: Record<string, unknown> = {};
    if (query.search) {
      where.OR = [
        { resource: { contains: query.search, mode: 'insensitive' } },
        { action: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.baseClient.permission.findMany({
        ...prismaArgs,
        where,
      }),
      this.prisma.baseClient.permission.count({ where }),
    ]);
    return buildPaginatedResponse(data, total, query);
  }

  // ── Role-Permission Assignment ──

  async assignPermissionsToRole(roleId: string, dto: AssignPermissionsDto) {
    const role = await this.prisma.baseClient.role.findUnique({
      where: { id: roleId },
    });
    if (!role)
      throw new NotFoundException(t('rbac.role_not_found', 'Role not found'));

    await this.prisma.baseClient.rolePermission.createMany({
      data: dto.permissionIds.map((permissionId) => ({
        roleId: roleId,
        permissionId: permissionId,
      })),
      skipDuplicates: true,
    });

    // Invalidate cache for all users with this role
    await this.permissionResolver.invalidateCacheForRole(roleId);

    return {
      message: t('rbac.permissions_assigned', 'Permissions assigned'),
    };
  }

  async revokePermissionsFromRole(roleId: string, dto: AssignPermissionsDto) {
    const role = await this.prisma.baseClient.role.findUnique({
      where: { id: roleId },
    });
    if (!role)
      throw new NotFoundException(t('rbac.role_not_found', 'Role not found'));

    await this.prisma.baseClient.rolePermission.deleteMany({
      where: {
        roleId: roleId,
        permissionId: { in: dto.permissionIds },
      },
    });

    await this.permissionResolver.invalidateCacheForRole(roleId);

    return {
      message: t('rbac.permissions_revoked', 'Permissions revoked'),
    };
  }

  // ── User Permission Overrides ──

  async findUserOverrides(userId: string) {
    return this.prisma.baseClient.userPermissionOverride.findMany({
      where: activeOverrideWhere(userId),
      select: OVERRIDE_SELECT,
      orderBy: { createdAt: 'desc' },
    });
  }

  async createOverride(
    userId: string,
    dto: CreateOverrideDto,
    grantedBy: string,
  ) {
    // Enforce one active override per (userId, permissionId) pair
    const existing =
      await this.prisma.baseClient.userPermissionOverride.findFirst({
        where: {
          ...activeOverrideWhere(userId),
          permissionId: dto.permissionId,
        },
        select: { id: true },
      });

    if (existing) {
      throw new ConflictException(
        t(
          'rbac.override_already_active',
          'An active override already exists for this user-permission pair. Revoke it first.',
        ),
      );
    }

    const override = await this.prisma.baseClient.userPermissionOverride.create(
      {
        data: {
          userId: userId,
          permissionId: dto.permissionId,
          grantType: dto.grantType,
          reason: dto.reason,
          grantedBy: grantedBy,
          expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        },
        select: OVERRIDE_SELECT,
      },
    );

    await this.permissionResolver.invalidateCache(userId);

    return override;
  }

  async revokeOverride(overrideId: string, revokedBy: string) {
    const override =
      await this.prisma.baseClient.userPermissionOverride.findUnique({
        where: { id: overrideId },
      });
    if (!override)
      throw new NotFoundException(
        t('rbac.override_not_found', 'Override not found'),
      );

    await this.prisma.baseClient.userPermissionOverride.update({
      where: { id: overrideId },
      data: {
        isActive: false,
        revokedBy: revokedBy,
        revokedAt: new Date(),
      },
    });

    await this.permissionResolver.invalidateCache(override.userId);

    return {
      message: t('rbac.override_revoked', 'Override revoked'),
    };
  }
}
