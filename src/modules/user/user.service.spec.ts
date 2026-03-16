import { Test } from '@nestjs/testing';
import {
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { UserService } from './user.service';
import { PrismaService } from '@modules/database';
import { CacheService } from '@modules/redis';
import { PermissionResolverService } from '@modules/rbac';
import { QueueProducerService } from '@modules/queue';

jest.mock('bcrypt', () => ({
  hash: jest.fn(),
}));

describe('UserService', () => {
  let service: UserService;
  let prisma: any;
  let cacheService: any;
  let permissionResolver: any;

  const mockUser = {
    id: 'user-1',
    email: 'test@example.com',
    full_name: 'Test User',
    phone: null,
    avatar_url: null,
    is_active: true,
    created_at: new Date(),
    updated_at: new Date(),
  };

  const mockUserWithRoles = { ...mockUser, user_roles: [] };

  beforeEach(async () => {
    prisma = {
      baseClient: {
        user: {
          findMany: jest.fn().mockResolvedValue([]),
          findUnique: jest.fn(),
          update: jest.fn(),
          count: jest.fn().mockResolvedValue(0),
        },
        userRole: {
          createMany: jest.fn().mockResolvedValue({}),
          deleteMany: jest.fn().mockResolvedValue({}),
        },
        userPermissionOverride: {
          findMany: jest.fn().mockResolvedValue([]),
        },
        role: {
          findMany: jest.fn(),
        },
        refreshToken: {
          findMany: jest.fn().mockResolvedValue([]),
          deleteMany: jest.fn().mockResolvedValue({}),
        },
      },
      transaction: jest.fn((fn: (tx: any) => unknown) =>
        fn({
          user: {
            create: jest.fn().mockResolvedValue(mockUser),
            findUnique: jest.fn().mockResolvedValue(mockUserWithRoles),
          },
          userRole: {
            createMany: jest.fn().mockResolvedValue({}),
          },
        }),
      ),
    };

    cacheService = {
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
    };

    permissionResolver = {
      invalidateCache: jest.fn().mockResolvedValue(undefined),
    };

    const module = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: PrismaService, useValue: prisma },
        { provide: CacheService, useValue: cacheService },
        { provide: PermissionResolverService, useValue: permissionResolver },
        { provide: QueueProducerService, useValue: { publish: jest.fn() } },
      ],
    }).compile();

    service = module.get(UserService);
  });

  describe('findAll', () => {
    it('should return paginated users', async () => {
      prisma.baseClient.user.findMany.mockResolvedValue([mockUserWithRoles]);
      prisma.baseClient.user.count.mockResolvedValue(1);

      const result = await service.findAll({});
      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
    });
  });

  describe('findById', () => {
    it('should throw NotFoundException for missing id', async () => {
      prisma.baseClient.user.findUnique.mockResolvedValue(null);

      await expect(service.findById('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should return user with overrides', async () => {
      prisma.baseClient.user.findUnique.mockResolvedValue(mockUserWithRoles);

      const result = await service.findById('user-1');
      expect(result.overrides).toBeDefined();
    });
  });

  describe('create', () => {
    it('should throw ConflictException for duplicate email', async () => {
      prisma.baseClient.user.findUnique.mockResolvedValue({ id: 'existing' });

      await expect(
        service.create({
          email: 'test@example.com',
          full_name: 'Test',
          password: 'Test1234',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('should hash password and create user in transaction', async () => {
      prisma.baseClient.user.findUnique.mockResolvedValueOnce(null);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-pw');

      await service.create({
        email: 'new@example.com',
        full_name: 'New User',
        password: 'Test1234',
        roleIds: ['role-1'],
      });

      expect(bcrypt.hash).toHaveBeenCalledWith('Test1234', 10);
      expect(prisma.transaction).toHaveBeenCalled();
    });
  });

  describe('updateStatus', () => {
    it('should invalidate cache and blacklist tokens when deactivating', async () => {
      prisma.baseClient.user.update.mockResolvedValue({
        ...mockUser,
        is_active: false,
      });
      prisma.baseClient.refreshToken.findMany.mockResolvedValue([
        {
          token_hash: 'hash1',
          expires_at: new Date(Date.now() + 100000),
        },
      ]);

      await service.updateStatus('user-1', { is_active: false });

      expect(permissionResolver.invalidateCache).toHaveBeenCalledWith('user-1');
      expect(cacheService.set).toHaveBeenCalledWith(
        'auth',
        'blacklist:hash1',
        true,
        expect.any(Number),
      );
      expect(prisma.baseClient.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: { user_id: 'user-1' },
      });
    });

    it('should NOT invalidate cache when activating', async () => {
      prisma.baseClient.user.update.mockResolvedValue({
        ...mockUser,
        is_active: true,
      });

      await service.updateStatus('user-1', { is_active: true });

      expect(permissionResolver.invalidateCache).not.toHaveBeenCalled();
    });
  });

  describe('assignRoles', () => {
    it('should assign roles and invalidate cache', async () => {
      prisma.baseClient.role.findMany.mockResolvedValue([{ id: 'role-1' }]);

      await service.assignRoles('user-1', { roleIds: ['role-1'] });

      expect(prisma.baseClient.userRole.createMany).toHaveBeenCalled();
      expect(permissionResolver.invalidateCache).toHaveBeenCalledWith('user-1');
    });

    it('should throw BadRequestException for invalid role IDs', async () => {
      prisma.baseClient.role.findMany.mockResolvedValue([]); // no roles found

      await expect(
        service.assignRoles('user-1', { roleIds: ['bad-id'] }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('removeRoles', () => {
    it('should remove roles and invalidate cache', async () => {
      await service.removeRoles('user-1', { roleIds: ['role-1'] });

      expect(prisma.baseClient.userRole.deleteMany).toHaveBeenCalled();
      expect(permissionResolver.invalidateCache).toHaveBeenCalledWith('user-1');
    });
  });
});
