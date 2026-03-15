import { Test } from '@nestjs/testing';
import {
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { RbacService } from './rbac.service';
import { PrismaService } from '@modules/database';
import { PermissionResolverService } from './services/permission-resolver.service';

describe('RbacService', () => {
  let service: RbacService;

  let prisma: any;

  let permissionResolver: any;

  beforeEach(async () => {
    prisma = {
      baseClient: {
        role: {
          findMany: jest.fn().mockResolvedValue([]),
          findUnique: jest.fn(),
          count: jest.fn().mockResolvedValue(0),
          create: jest.fn(),
          update: jest.fn(),
          delete: jest.fn(),
        },
        permission: {
          findMany: jest.fn().mockResolvedValue([]),
          findUnique: jest.fn(),
          count: jest.fn().mockResolvedValue(0),
          create: jest.fn(),
          update: jest.fn(),
          delete: jest.fn(),
        },
        rolePermission: {
          createMany: jest.fn(),
          deleteMany: jest.fn(),
        },
        userPermissionOverride: {
          findMany: jest.fn().mockResolvedValue([]),
          findUnique: jest.fn(),
          create: jest.fn(),
          update: jest.fn(),
        },
      },
    };

    permissionResolver = {
      invalidateCache: jest.fn().mockResolvedValue(undefined),
      invalidateCacheForRole: jest.fn().mockResolvedValue(undefined),
    };

    const module = await Test.createTestingModule({
      providers: [
        RbacService,
        { provide: PrismaService, useValue: prisma },
        { provide: PermissionResolverService, useValue: permissionResolver },
      ],
    }).compile();

    service = module.get(RbacService);
  });

  describe('Roles', () => {
    it('should find role by id', async () => {
      const role = {
        id: 'r1',
        name: 'admin',
        role_permissions: [],
        _count: { user_roles: 2 },
      };
      prisma.baseClient.role.findUnique.mockResolvedValue(role);

      const result = await service.findRoleById('r1');
      expect(result).toEqual(role);
    });

    it('should throw NotFoundException for missing role', async () => {
      prisma.baseClient.role.findUnique.mockResolvedValue(null);
      await expect(service.findRoleById('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should create a non-system role', async () => {
      prisma.baseClient.role.create.mockResolvedValue({
        id: 'r1',
        name: 'staff',
        is_system: false,
      });

      await service.createRole({
        name: 'staff',
        description: 'Staff role',
      });
      expect(prisma.baseClient.role.create).toHaveBeenCalledWith({
        data: { name: 'staff', description: 'Staff role', is_system: false },
      });
    });

    it('should throw ForbiddenException when renaming a system role', async () => {
      prisma.baseClient.role.findUnique.mockResolvedValue({
        id: 'r1',
        name: 'admin',
        is_system: true,
      });

      await expect(
        service.updateRole('r1', { name: 'new-name' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should allow updating description of system role', async () => {
      prisma.baseClient.role.findUnique.mockResolvedValue({
        id: 'r1',
        name: 'admin',
        is_system: true,
      });
      prisma.baseClient.role.update.mockResolvedValue({});

      await service.updateRole('r1', { description: 'Updated desc' });
      expect(prisma.baseClient.role.update).toHaveBeenCalledWith({
        where: { id: 'r1' },
        data: { name: undefined, description: 'Updated desc' },
      });
    });

    it('should throw ForbiddenException when deleting system role', async () => {
      prisma.baseClient.role.findUnique.mockResolvedValue({
        id: 'r1',
        is_system: true,
        _count: { user_roles: 0 },
      });

      await expect(service.deleteRole('r1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw BadRequestException when deleting role with users', async () => {
      prisma.baseClient.role.findUnique.mockResolvedValue({
        id: 'r1',
        is_system: false,
        _count: { user_roles: 3 },
      });

      await expect(service.deleteRole('r1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should delete role successfully', async () => {
      prisma.baseClient.role.findUnique.mockResolvedValue({
        id: 'r1',
        is_system: false,
        _count: { user_roles: 0 },
      });
      prisma.baseClient.role.delete.mockResolvedValue({});

      const result = await service.deleteRole('r1');
      expect(result).toEqual({ message: 'Role deleted' });
    });
  });

  describe('Permissions', () => {
    it('should throw ConflictException for duplicate permission', async () => {
      prisma.baseClient.permission.findUnique.mockResolvedValue({ id: 'p1' });

      await expect(
        service.createPermission({ resource: 'user', action: 'read' }),
      ).rejects.toThrow(ConflictException);
    });

    it('should create permission when unique', async () => {
      prisma.baseClient.permission.findUnique.mockResolvedValue(null);
      prisma.baseClient.permission.create.mockResolvedValue({
        id: 'p1',
        resource: 'user',
        action: 'read',
      });

      await service.createPermission({ resource: 'user', action: 'read' });
      expect(prisma.baseClient.permission.create).toHaveBeenCalled();
    });

    it('should throw BadRequestException when deleting permission assigned to roles', async () => {
      prisma.baseClient.permission.findUnique.mockResolvedValue({
        id: 'p1',
        _count: { role_permissions: 2, user_permission_overrides: 0 },
      });

      await expect(service.deletePermission('p1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('Role-Permission Assignment', () => {
    it('should assign permissions and invalidate cache', async () => {
      prisma.baseClient.role.findUnique.mockResolvedValue({ id: 'r1' });
      prisma.baseClient.rolePermission.createMany.mockResolvedValue({});

      await service.assignPermissionsToRole('r1', {
        permissionIds: ['p1', 'p2'],
      });

      expect(prisma.baseClient.rolePermission.createMany).toHaveBeenCalled();
      expect(permissionResolver.invalidateCacheForRole).toHaveBeenCalledWith(
        'r1',
      );
    });

    it('should throw NotFoundException for missing role', async () => {
      prisma.baseClient.role.findUnique.mockResolvedValue(null);

      await expect(
        service.assignPermissionsToRole('missing', { permissionIds: ['p1'] }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('User Permission Overrides', () => {
    it('should create override and invalidate cache', async () => {
      prisma.baseClient.userPermissionOverride.create.mockResolvedValue({
        id: 'o1',
        permission: { resource: 'user', action: 'delete' },
      });

      await service.createOverride(
        'user-1',
        { permissionId: 'p1', grantType: 'grant', reason: 'temp access' },
        'admin-1',
      );

      expect(permissionResolver.invalidateCache).toHaveBeenCalledWith('user-1');
    });

    it('should revoke override and invalidate cache', async () => {
      prisma.baseClient.userPermissionOverride.findUnique.mockResolvedValue({
        id: 'o1',
        user_id: 'user-1',
      });
      prisma.baseClient.userPermissionOverride.update.mockResolvedValue({});

      await service.revokeOverride('o1', 'admin-1');

      expect(
        prisma.baseClient.userPermissionOverride.update,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            is_active: false,
            revoked_by: 'admin-1',
          }),
        }),
      );
      expect(permissionResolver.invalidateCache).toHaveBeenCalledWith('user-1');
    });

    it('should throw NotFoundException for missing override', async () => {
      prisma.baseClient.userPermissionOverride.findUnique.mockResolvedValue(
        null,
      );
      await expect(service.revokeOverride('missing', 'admin')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
