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
import { PermissionResolverService } from './services/permission-resolver.service';
import type { CreateRoleDto } from './dto/create-role.dto';
import type { UpdateRoleDto } from './dto/update-role.dto';
import type { CreatePermissionDto } from './dto/create-permission.dto';
import type { UpdatePermissionDto } from './dto/update-permission.dto';
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
    const prismaArgs = buildPrismaQuery(query, ['name', 'created_at']);
    const [data, total] = await Promise.all([
      this.prisma.baseClient.role.findMany({
        ...prismaArgs,
        include: { _count: { select: { user_roles: true } } },
      }),
      this.prisma.baseClient.role.count(),
    ]);
    return buildPaginatedResponse(data, total, query);
  }

  async findRoleById(id: string) {
    const role = await this.prisma.baseClient.role.findUnique({
      where: { id },
      include: {
        role_permissions: {
          include: { permission: true },
        },
        _count: { select: { user_roles: true } },
      },
    });
    if (!role) throw new NotFoundException('Role not found');
    return role;
  }

  async createRole(dto: CreateRoleDto) {
    return this.prisma.baseClient.role.create({
      data: {
        name: dto.name,
        description: dto.description,
        is_system: false,
      },
    });
  }

  async updateRole(id: string, dto: UpdateRoleDto) {
    const role = await this.prisma.baseClient.role.findUnique({
      where: { id },
    });
    if (!role) throw new NotFoundException('Role not found');

    // System roles: only description can be changed
    if (role.is_system && dto.name && dto.name !== role.name) {
      throw new ForbiddenException('Cannot rename a system role');
    }

    return this.prisma.baseClient.role.update({
      where: { id },
      data: {
        name: role.is_system ? undefined : dto.name,
        description: dto.description,
      },
    });
  }

  async deleteRole(id: string) {
    const role = await this.prisma.baseClient.role.findUnique({
      where: { id },
      include: { _count: { select: { user_roles: true } } },
    });
    if (!role) throw new NotFoundException('Role not found');
    if (role.is_system) {
      throw new ForbiddenException('Cannot delete a system role');
    }
    if (role._count.user_roles > 0) {
      throw new BadRequestException(
        'Cannot delete role with assigned users. Remove users from this role first.',
      );
    }

    await this.prisma.baseClient.role.delete({ where: { id } });
    return { message: 'Role deleted' };
  }

  // ── Permissions ──

  async findAllPermissions(query: PaginationQueryDto) {
    const prismaArgs = buildPrismaQuery(query, ['resource', 'action']);

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

  async createPermission(dto: CreatePermissionDto) {
    const existing = await this.prisma.baseClient.permission.findUnique({
      where: {
        resource_action: { resource: dto.resource, action: dto.action },
      },
    });
    if (existing) {
      throw new ConflictException(
        `Permission ${dto.resource}:${dto.action} already exists`,
      );
    }

    return this.prisma.baseClient.permission.create({
      data: {
        resource: dto.resource,
        action: dto.action,
        description: dto.description,
      },
    });
  }

  async updatePermission(id: string, dto: UpdatePermissionDto) {
    const permission = await this.prisma.baseClient.permission.findUnique({
      where: { id },
    });
    if (!permission) throw new NotFoundException('Permission not found');

    return this.prisma.baseClient.permission.update({
      where: { id },
      data: { description: dto.description },
    });
  }

  async deletePermission(id: string) {
    const permission = await this.prisma.baseClient.permission.findUnique({
      where: { id },
      include: {
        _count: {
          select: { role_permissions: true, user_permission_overrides: true },
        },
      },
    });
    if (!permission) throw new NotFoundException('Permission not found');
    if (permission._count.role_permissions > 0) {
      throw new BadRequestException(
        'Cannot delete permission that is assigned to roles. Remove it from roles first.',
      );
    }

    await this.prisma.baseClient.permission.delete({ where: { id } });
    return { message: 'Permission deleted' };
  }

  // ── Role-Permission Assignment ──

  async assignPermissionsToRole(roleId: string, dto: AssignPermissionsDto) {
    const role = await this.prisma.baseClient.role.findUnique({
      where: { id: roleId },
    });
    if (!role) throw new NotFoundException('Role not found');

    await this.prisma.baseClient.rolePermission.createMany({
      data: dto.permissionIds.map((permissionId) => ({
        role_id: roleId,
        permission_id: permissionId,
      })),
      skipDuplicates: true,
    });

    // Invalidate cache for all users with this role
    await this.permissionResolver.invalidateCacheForRole(roleId);

    return { message: 'Permissions assigned' };
  }

  async revokePermissionsFromRole(roleId: string, dto: AssignPermissionsDto) {
    const role = await this.prisma.baseClient.role.findUnique({
      where: { id: roleId },
    });
    if (!role) throw new NotFoundException('Role not found');

    await this.prisma.baseClient.rolePermission.deleteMany({
      where: {
        role_id: roleId,
        permission_id: { in: dto.permissionIds },
      },
    });

    await this.permissionResolver.invalidateCacheForRole(roleId);

    return { message: 'Permissions revoked' };
  }

  // ── User Permission Overrides ──

  async findUserOverrides(userId: string) {
    return this.prisma.baseClient.userPermissionOverride.findMany({
      where: { user_id: userId, is_active: true },
      include: { permission: true },
      orderBy: { created_at: 'desc' },
    });
  }

  async createOverride(
    userId: string,
    dto: CreateOverrideDto,
    grantedBy: string,
  ) {
    const override = await this.prisma.baseClient.userPermissionOverride.create(
      {
        data: {
          user_id: userId,
          permission_id: dto.permissionId,
          grant_type: dto.grantType,
          reason: dto.reason,
          granted_by: grantedBy,
          expires_at: dto.expiresAt ? new Date(dto.expiresAt) : null,
        },
        include: { permission: true },
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
    if (!override) throw new NotFoundException('Override not found');

    await this.prisma.baseClient.userPermissionOverride.update({
      where: { id: overrideId },
      data: {
        is_active: false,
        revoked_by: revokedBy,
        revoked_at: new Date(),
      },
    });

    await this.permissionResolver.invalidateCache(override.user_id);

    return { message: 'Override revoked' };
  }
}
