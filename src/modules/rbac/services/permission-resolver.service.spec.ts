import { Test } from '@nestjs/testing';
import { PermissionResolverService } from './permission-resolver.service';
import { PrismaService } from '@modules/database';
import { CacheService } from '@modules/redis';

describe('PermissionResolverService', () => {
  let service: PermissionResolverService;

  let prisma: any;

  let cacheService: any;

  beforeEach(async () => {
    prisma = {
      baseClient: {
        userRole: { findMany: jest.fn() },
        userPermissionOverride: { findMany: jest.fn() },
      },
    };

    cacheService = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
    };

    const module = await Test.createTestingModule({
      providers: [
        PermissionResolverService,
        { provide: PrismaService, useValue: prisma },
        { provide: CacheService, useValue: cacheService },
      ],
    }).compile();

    service = module.get(PermissionResolverService);
  });

  describe('resolvePermissions', () => {
    it('should return cached permissions if available', async () => {
      cacheService.get.mockResolvedValue(['user:read', 'user:write']);

      const result = await service.resolvePermissions('user-1');
      expect(result).toEqual(['user:read', 'user:write']);
      expect(prisma.baseClient.userRole.findMany).not.toHaveBeenCalled();
    });

    it('should resolve from DB and cache when no cache hit', async () => {
      cacheService.get.mockResolvedValue(null);
      prisma.baseClient.userRole.findMany.mockResolvedValue([
        {
          role: {
            role_permissions: [
              { permission: { resource: 'user', action: 'read' } },
              { permission: { resource: 'user', action: 'write' } },
            ],
          },
        },
      ]);
      prisma.baseClient.userPermissionOverride.findMany.mockResolvedValue([]);

      const result = await service.resolvePermissions('user-1');
      expect(result).toEqual(['user:read', 'user:write']);
      expect(cacheService.set).toHaveBeenCalled();
    });

    it('should pass expiry filter when querying overrides', async () => {
      cacheService.get.mockResolvedValue(null);
      prisma.baseClient.userRole.findMany.mockResolvedValue([]);
      prisma.baseClient.userPermissionOverride.findMany.mockResolvedValue([]);

      await service.resolvePermissions('user-1');

      expect(
        prisma.baseClient.userPermissionOverride.findMany,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            user_id: 'user-1',
            is_active: true,
            OR: [
              { expires_at: null },
              { expires_at: { gt: expect.any(Date) } },
            ],
          }),
        }),
      );
    });

    it('should apply grant overrides', async () => {
      cacheService.get.mockResolvedValue(null);
      prisma.baseClient.userRole.findMany.mockResolvedValue([]);
      prisma.baseClient.userPermissionOverride.findMany.mockResolvedValue([
        {
          grant_type: 'grant',
          permission: { resource: 'admin', action: 'access' },
        },
      ]);

      const result = await service.resolvePermissions('user-1');
      expect(result).toEqual(['admin:access']);
    });

    it('should resolve scoped permissions as resource:action:scope', async () => {
      cacheService.get.mockResolvedValue(null);
      prisma.baseClient.userRole.findMany.mockResolvedValue([
        {
          role: {
            role_permissions: [
              {
                permission: {
                  resource: 'users',
                  action: 'create',
                  scope: null,
                },
              },
              {
                permission: {
                  resource: 'users',
                  action: 'create',
                  scope: 'admin',
                },
              },
            ],
          },
        },
      ]);
      prisma.baseClient.userPermissionOverride.findMany.mockResolvedValue([]);

      const result = await service.resolvePermissions('user-1');
      expect(result).toEqual(['users:create', 'users:create:admin']);
    });

    it('should handle mixed scoped and non-scoped permissions', async () => {
      cacheService.get.mockResolvedValue(null);
      prisma.baseClient.userRole.findMany.mockResolvedValue([
        {
          role: {
            role_permissions: [
              {
                permission: { resource: 'users', action: 'read', scope: null },
              },
              {
                permission: {
                  resource: 'users',
                  action: 'update',
                  scope: 'admin',
                },
              },
              {
                permission: {
                  resource: 'appointments',
                  action: 'update',
                  scope: null,
                },
              },
            ],
          },
        },
      ]);
      prisma.baseClient.userPermissionOverride.findMany.mockResolvedValue([]);

      const result = await service.resolvePermissions('user-1');
      expect(result).toEqual([
        'appointments:update',
        'users:read',
        'users:update:admin',
      ]);
    });

    it('should apply grant overrides with scope', async () => {
      cacheService.get.mockResolvedValue(null);
      prisma.baseClient.userRole.findMany.mockResolvedValue([]);
      prisma.baseClient.userPermissionOverride.findMany.mockResolvedValue([
        {
          grant_type: 'grant',
          permission: { resource: 'users', action: 'create', scope: 'admin' },
        },
      ]);

      const result = await service.resolvePermissions('user-1');
      expect(result).toEqual(['users:create:admin']);
    });

    it('should apply deny overrides with scope', async () => {
      cacheService.get.mockResolvedValue(null);
      prisma.baseClient.userRole.findMany.mockResolvedValue([
        {
          role: {
            role_permissions: [
              {
                permission: {
                  resource: 'users',
                  action: 'create',
                  scope: null,
                },
              },
              {
                permission: {
                  resource: 'users',
                  action: 'create',
                  scope: 'admin',
                },
              },
            ],
          },
        },
      ]);
      prisma.baseClient.userPermissionOverride.findMany.mockResolvedValue([
        {
          grant_type: 'deny',
          permission: { resource: 'users', action: 'create', scope: 'admin' },
        },
      ]);

      const result = await service.resolvePermissions('user-1');
      expect(result).toEqual(['users:create']);
    });

    it('should apply deny overrides', async () => {
      cacheService.get.mockResolvedValue(null);
      prisma.baseClient.userRole.findMany.mockResolvedValue([
        {
          role: {
            role_permissions: [
              { permission: { resource: 'user', action: 'delete' } },
              { permission: { resource: 'user', action: 'read' } },
            ],
          },
        },
      ]);
      prisma.baseClient.userPermissionOverride.findMany.mockResolvedValue([
        {
          grant_type: 'deny',
          permission: { resource: 'user', action: 'delete' },
        },
      ]);

      const result = await service.resolvePermissions('user-1');
      expect(result).toEqual(['user:read']);
    });
  });

  describe('hasPermission', () => {
    it('should return true when user has permission', async () => {
      cacheService.get.mockResolvedValue(['user:read', 'user:write']);
      expect(await service.hasPermission('user-1', 'user:read')).toBe(true);
    });

    it('should return false when user lacks permission', async () => {
      cacheService.get.mockResolvedValue(['user:read']);
      expect(await service.hasPermission('user-1', 'user:delete')).toBe(false);
    });
  });

  describe('hasAllPermissions', () => {
    it('should return true when user has all required permissions', async () => {
      cacheService.get.mockResolvedValue([
        'user:read',
        'user:write',
        'user:delete',
      ]);
      expect(
        await service.hasAllPermissions('user-1', ['user:read', 'user:write']),
      ).toBe(true);
    });

    it('should return false when user is missing any permission', async () => {
      cacheService.get.mockResolvedValue(['user:read']);
      expect(
        await service.hasAllPermissions('user-1', ['user:read', 'user:write']),
      ).toBe(false);
    });
  });

  describe('hasAnyPermission', () => {
    it('should return true when user has at least one permission', async () => {
      cacheService.get.mockResolvedValue(['user:read']);
      expect(
        await service.hasAnyPermission('user-1', ['user:read', 'user:write']),
      ).toBe(true);
    });

    it('should return false when user has none of the permissions', async () => {
      cacheService.get.mockResolvedValue(['user:read']);
      expect(
        await service.hasAnyPermission('user-1', ['user:delete', 'user:write']),
      ).toBe(false);
    });
  });

  describe('invalidateCache', () => {
    it('should delete cache for user', async () => {
      await service.invalidateCache('user-1');
      expect(cacheService.del).toHaveBeenCalledWith('rbac', 'perms:user-1');
    });
  });

  describe('invalidateCacheForRole', () => {
    it('should invalidate cache for all users with the role', async () => {
      prisma.baseClient.userRole.findMany.mockResolvedValue([
        { user_id: 'u1' },
        { user_id: 'u2' },
      ]);

      await service.invalidateCacheForRole('r1');

      expect(cacheService.del).toHaveBeenCalledWith('rbac', 'perms:u1');
      expect(cacheService.del).toHaveBeenCalledWith('rbac', 'perms:u2');
    });
  });
});
