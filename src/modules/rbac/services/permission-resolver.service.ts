import { CACHE_DOMAIN_RBAC, PERMISSION_CACHE_TTL } from '@common/constants';
import { PrismaService } from '@modules/database';
import { CacheService } from '@modules/redis';
import { Injectable } from '@nestjs/common';

@Injectable()
export class PermissionResolverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
  ) {}

  private buildPermissionKey(p: {
    resource: string;
    action: string;
    scope?: string | null;
  }): string {
    return p.scope
      ? `${p.resource}:${p.action}:${p.scope}`
      : `${p.resource}:${p.action}`;
  }

  async resolvePermissions(userId: string): Promise<string[]> {
    const cached = await this.cacheService.get<string[]>(
      CACHE_DOMAIN_RBAC,
      `perms:${userId}`,
    );
    if (cached) return cached;

    // Fetch role permissions and user overrides in parallel
    const [userRoles, overrides] = await Promise.all([
      this.prisma.baseClient.userRole.findMany({
        where: { user_id: userId },
        include: {
          role: {
            include: {
              role_permissions: {
                include: {
                  permission: {
                    select: { resource: true, action: true, scope: true },
                  },
                },
              },
            },
          },
        },
      }),
      this.prisma.baseClient.userPermissionOverride.findMany({
        where: {
          user_id: userId,
          is_active: true,
          OR: [{ expires_at: null }, { expires_at: { gt: new Date() } }],
        },
        include: {
          permission: {
            select: { resource: true, action: true, scope: true },
          },
        },
      }),
    ]);

    const permissionSet = new Set<string>();
    for (const ur of userRoles) {
      for (const rp of ur.role.role_permissions) {
        permissionSet.add(this.buildPermissionKey(rp.permission));
      }
    }

    for (const override of overrides) {
      const permKey = this.buildPermissionKey(override.permission);
      if (override.grant_type === 'deny') {
        permissionSet.delete(permKey);
      } else if (override.grant_type === 'grant') {
        permissionSet.add(permKey);
      }
    }

    const permissions = Array.from(permissionSet).sort();

    await this.cacheService.set(
      CACHE_DOMAIN_RBAC,
      `perms:${userId}`,
      permissions,
      PERMISSION_CACHE_TTL,
    );

    return permissions;
  }

  async hasPermission(userId: string, permission: string): Promise<boolean> {
    const permissions = await this.resolvePermissions(userId);
    return permissions.includes(permission);
  }

  async hasAllPermissions(
    userId: string,
    required: string[],
  ): Promise<boolean> {
    const permissions = await this.resolvePermissions(userId);
    return required.every((p) => permissions.includes(p));
  }

  async hasAnyPermission(userId: string, required: string[]): Promise<boolean> {
    const permissions = await this.resolvePermissions(userId);
    return required.some((p) => permissions.includes(p));
  }

  async invalidateCache(userId: string): Promise<void> {
    await this.cacheService.del(CACHE_DOMAIN_RBAC, `perms:${userId}`);
  }

  async invalidateCacheForRole(roleId: string): Promise<void> {
    const userRoles = await this.prisma.baseClient.userRole.findMany({
      where: { role_id: roleId },
      select: { user_id: true },
    });

    await Promise.all(userRoles.map((ur) => this.invalidateCache(ur.user_id)));
  }
}
