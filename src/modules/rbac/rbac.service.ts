import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  forwardRef,
  Inject,
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
import {
  DEFAULT_ROLE_PERMISSIONS,
  RESETTABLE_ROLE_CODES,
} from './default-role-permissions';
import { SYSTEM_ROLE_CODE } from '@common/constants';
import { AuditService } from '@modules/audit/audit.service';
import { Prisma } from '@prisma/client';
import {
  DOC_ACCESS_ACTION,
  DOC_ACCESS_RESOURCE,
  SYSTEM_DOCUMENT_ACCESS_SCOPES,
} from './rbac.constants';
import type { CreateDocumentsAccessPermissionDto } from './dto/create-documents-access-permission.dto';
import type { UpdateDocumentsAccessPermissionDto } from './dto/update-documents-access-permission.dto';

@Injectable()
export class RbacService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissionResolver: PermissionResolverService,
    @Inject(forwardRef(() => AuditService))
    private readonly auditService: AuditService,
  ) {}

  private async getRolePermissionIds(roleId: string): Promise<string[]> {
    const rows = await this.prisma.baseClient.rolePermission.findMany({
      where: { roleId },
      select: { permissionId: true },
      orderBy: { permissionId: 'asc' },
    });
    return rows.map((r) => r.permissionId);
  }

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

    // `code` is the stable machine identifier for system roles, so `name`
    // (display label) is safe to rename for both system and custom roles.
    return this.prisma.baseClient.role.update({
      where: { id },
      data: {
        name: dto.name,
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

  // ── Document-Access Permissions (documents:access:{scope}) ──

  private readonly DOCUMENTS_ACCESS_SELECT = {
    id: true,
    resource: true,
    action: true,
    scope: true,
    description: true,
  } as const;

  async listDocumentsAccessPermissions() {
    return this.prisma.baseClient.permission.findMany({
      where: { resource: DOC_ACCESS_RESOURCE, action: DOC_ACCESS_ACTION },
      orderBy: { scope: 'asc' },
      select: this.DOCUMENTS_ACCESS_SELECT,
    });
  }

  async createDocumentsAccessPermission(
    dto: CreateDocumentsAccessPermissionDto,
  ) {
    try {
      const permission = await this.prisma.baseClient.permission.create({
        data: {
          resource: DOC_ACCESS_RESOURCE,
          action: DOC_ACCESS_ACTION,
          scope: dto.scope,
          description: dto.description ?? null,
        },
        select: this.DOCUMENTS_ACCESS_SELECT,
      });

      this.auditService.emit({
        code: 'RBAC_PERMISSION_CREATED',
        resource: 'permission',
        resourceId: permission.id,
        after: {
          resource: permission.resource,
          action: permission.action,
          scope: permission.scope,
        },
      });

      return permission;
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          t(
            'rbac.documents_access_scope_exists',
            'A documents:access permission with this scope already exists',
          ),
        );
      }
      throw err;
    }
  }

  // Loads a permission and guarantees it is a *custom* documents:access scope
  // (not a system default), so update/delete can never touch other permissions.
  private async assertCustomDocumentsAccessPermission(id: string) {
    const permission = await this.prisma.baseClient.permission.findUnique({
      where: { id },
      select: this.DOCUMENTS_ACCESS_SELECT,
    });
    if (
      !permission ||
      permission.resource !== DOC_ACCESS_RESOURCE ||
      permission.action !== DOC_ACCESS_ACTION
    ) {
      throw new NotFoundException(
        t(
          'rbac.documents_access_permission_invalid',
          'documents:access permission not found',
        ),
      );
    }
    if (
      permission.scope &&
      SYSTEM_DOCUMENT_ACCESS_SCOPES.includes(permission.scope)
    ) {
      throw new ForbiddenException(
        t(
          'rbac.documents_access_scope_system',
          'System-default access scopes cannot be modified or deleted',
        ),
      );
    }
    return permission;
  }

  async updateDocumentsAccessPermission(
    id: string,
    dto: UpdateDocumentsAccessPermissionDto,
  ) {
    await this.assertCustomDocumentsAccessPermission(id);

    const permission = await this.prisma.baseClient.permission.update({
      where: { id },
      data: { description: dto.description },
      select: this.DOCUMENTS_ACCESS_SELECT,
    });

    this.auditService.emit({
      code: 'RBAC_PERMISSION_UPDATED',
      resource: 'permission',
      resourceId: id,
      after: { description: permission.description },
    });

    return permission;
  }

  async deleteDocumentsAccessPermission(id: string) {
    const permission = await this.assertCustomDocumentsAccessPermission(id);

    // Count-and-delete in one transaction: blocks deletion while the scope
    // still gates a document (its document_access row would otherwise cascade
    // away and silently un-restrict that document). Role/override cascades are
    // intended; their caches are invalidated below.
    const { roleIds, userIds } = await this.prisma.transaction(async (tx) => {
      const docRefs = await tx.documentAccess.count({
        where: { permissionId: id },
      });
      if (docRefs > 0) {
        throw new ConflictException(
          t(
            'rbac.documents_access_permission_in_use',
            'This access scope is assigned to one or more documents. Remove it from those documents first.',
          ),
        );
      }

      const roleRows = await tx.rolePermission.findMany({
        where: { permissionId: id },
        select: { roleId: true },
      });
      const overrideRows = await tx.userPermissionOverride.findMany({
        where: { permissionId: id },
        select: { userId: true },
      });

      await tx.permission.delete({ where: { id } });

      return {
        roleIds: roleRows.map((r) => r.roleId),
        userIds: [...new Set(overrideRows.map((o) => o.userId))],
      };
    });

    for (const roleId of roleIds) {
      await this.permissionResolver.invalidateCacheForRole(roleId);
    }
    for (const userId of userIds) {
      await this.permissionResolver.invalidateCache(userId);
    }

    this.auditService.emit({
      code: 'RBAC_PERMISSION_DELETED',
      resource: 'permission',
      resourceId: id,
      before: { scope: permission.scope },
      metadata: {
        affectedRoles: roleIds.length,
        affectedUsers: userIds.length,
      },
    });

    return {
      message: t(
        'rbac.documents_access_permission_deleted',
        'Access scope deleted',
      ),
      affectedRoles: roleIds.length,
      affectedUsers: userIds.length,
    };
  }

  // ── Role-Permission Assignment ──

  async assignPermissionsToRole(roleId: string, dto: AssignPermissionsDto) {
    const role = await this.prisma.baseClient.role.findUnique({
      where: { id: roleId },
    });
    if (!role)
      throw new NotFoundException(t('rbac.role_not_found', 'Role not found'));

    const beforeIds = await this.getRolePermissionIds(roleId);

    await this.prisma.baseClient.rolePermission.createMany({
      data: dto.permissionIds.map((permissionId) => ({
        roleId: roleId,
        permissionId: permissionId,
      })),
      skipDuplicates: true,
    });

    // Invalidate cache for all users with this role
    await this.permissionResolver.invalidateCacheForRole(roleId);

    const afterIds = await this.getRolePermissionIds(roleId);
    this.auditService.emit({
      code: 'RBAC_ROLE_PERMISSIONS_ASSIGNED',
      resource: 'role',
      resourceId: roleId,
      before: { permissionIds: beforeIds },
      after: { permissionIds: afterIds },
    });

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

    const beforeIds = await this.getRolePermissionIds(roleId);

    await this.prisma.baseClient.rolePermission.deleteMany({
      where: {
        roleId: roleId,
        permissionId: { in: dto.permissionIds },
      },
    });

    await this.permissionResolver.invalidateCacheForRole(roleId);

    const afterIds = await this.getRolePermissionIds(roleId);
    this.auditService.emit({
      code: 'RBAC_ROLE_PERMISSIONS_REVOKED',
      resource: 'role',
      resourceId: roleId,
      before: { permissionIds: beforeIds },
      after: { permissionIds: afterIds },
    });

    return {
      message: t('rbac.permissions_revoked', 'Permissions revoked'),
    };
  }

  // Replace a system role's permissions with its seeded defaults.
  // ADMIN resolves dynamically to "every permission currently in the table"
  // so newly seeded permissions flow in automatically; other roles use the
  // static list in `default-role-permissions.ts`.
  async resetRolePermissions(roleId: string) {
    const role = await this.prisma.baseClient.role.findUnique({
      where: { id: roleId },
      select: { id: true, code: true, isSystem: true },
    });
    if (!role)
      throw new NotFoundException(t('rbac.role_not_found', 'Role not found'));

    if (
      !role.code ||
      !role.isSystem ||
      !RESETTABLE_ROLE_CODES.includes(role.code)
    ) {
      throw new BadRequestException(
        t(
          'rbac.cannot_reset_non_system_role',
          'Only system roles can be reset to defaults',
        ),
      );
    }

    // Resolve the target permission IDs.
    let targetIds: string[];
    if (role.code === SYSTEM_ROLE_CODE.ADMIN) {
      const all = await this.prisma.baseClient.permission.findMany({
        select: { id: true },
      });
      targetIds = all.map((p) => p.id);
    } else {
      const keys = DEFAULT_ROLE_PERMISSIONS[role.code] ?? [];
      const perms = await this.prisma.baseClient.permission.findMany({
        select: { id: true, resource: true, action: true, scope: true },
      });
      const lookup = new Map<string, string>();
      for (const p of perms) {
        const key = p.scope
          ? `${p.resource}:${p.action}:${p.scope}`
          : `${p.resource}:${p.action}`;
        lookup.set(key, p.id);
      }
      targetIds = keys
        .map((k) => lookup.get(k))
        .filter((id): id is string => !!id);
    }

    const beforeIds = await this.getRolePermissionIds(roleId);

    await this.prisma.transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId } });
      if (targetIds.length > 0) {
        await tx.rolePermission.createMany({
          data: targetIds.map((permissionId) => ({ roleId, permissionId })),
          skipDuplicates: true,
        });
      }
    });

    await this.permissionResolver.invalidateCacheForRole(roleId);

    const afterIds = await this.getRolePermissionIds(roleId);
    this.auditService.emit({
      code: 'RBAC_ROLE_PERMISSIONS_RESET',
      resource: 'role',
      resourceId: roleId,
      before: { permissionIds: beforeIds },
      after: { permissionIds: afterIds },
      metadata: { assignedCount: targetIds.length },
    });

    return {
      message: t('rbac.permissions_reset', 'Permissions reset to defaults'),
      assignedCount: targetIds.length,
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

    this.auditService.emit({
      code: 'RBAC_USER_OVERRIDE_GRANTED',
      resource: 'user',
      resourceId: userId,
      after: {
        permissionId: dto.permissionId,
        grantType: dto.grantType,
        overrideId: override.id,
      },
    });

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

    this.auditService.emit({
      code: 'RBAC_USER_OVERRIDE_REVOKED',
      resource: 'user',
      resourceId: override.userId,
      before: {
        overrideId,
        permissionId: override.permissionId,
      },
      after: { revoked: true },
    });

    return {
      message: t('rbac.override_revoked', 'Override revoked'),
    };
  }
}
