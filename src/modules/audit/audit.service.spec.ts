import { Test } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AuditService } from './audit.service';
import { PrismaService } from '@modules/database';
import { PermissionResolverService } from '@modules/rbac';

describe('AuditService', () => {
  let service: AuditService;

  let prisma: any;
  let permissionResolver: any;

  const ADMIN_USER_ID = 'admin-1';
  const MANAGER_USER_ID = 'manager-1';
  const DOCTOR_USER_ID = 'doctor-1';

  beforeEach(async () => {
    prisma = {
      baseClient: {
        auditLog: {
          create: jest.fn().mockResolvedValue({}),
          findMany: jest.fn().mockResolvedValue([]),
          findUnique: jest.fn(),
          count: jest.fn().mockResolvedValue(0),
        },
      },
    };

    permissionResolver = {
      resolvePermissions: jest
        .fn()
        .mockResolvedValue(['audit_logs:read', 'audit_logs:read:all']),
    };

    const module = await Test.createTestingModule({
      providers: [
        AuditService,
        { provide: PrismaService, useValue: prisma },
        { provide: PermissionResolverService, useValue: permissionResolver },
      ],
    }).compile();

    service = module.get(AuditService);
  });

  describe('log', () => {
    it('should create audit log entry', async () => {
      await service.log({
        userId: 'u1',
        action: 'create',
        resource: 'user',
        resourceId: 'r1',
        ipAddress: '127.0.0.1',
      });

      expect(prisma.baseClient.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'u1',
          action: 'create',
          resource: 'user',
        }),
      });
    });

    it('should not throw on database error', async () => {
      prisma.baseClient.auditLog.create.mockRejectedValue(
        new Error('db error'),
      );
      await expect(
        service.log({ action: 'create', resource: 'user' }),
      ).resolves.toBeUndefined();
    });
  });

  describe('findAll', () => {
    it('should return paginated result with user join', async () => {
      prisma.baseClient.auditLog.findMany.mockResolvedValue([]);
      prisma.baseClient.auditLog.count.mockResolvedValue(0);

      const result = await service.findAll({}, ADMIN_USER_ID);
      expect(prisma.baseClient.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            user: expect.any(Object),
          }),
        }),
      );
      expect(result.meta.page).toBe(1);
    });

    it('should apply filters', async () => {
      prisma.baseClient.auditLog.findMany.mockResolvedValue([]);
      prisma.baseClient.auditLog.count.mockResolvedValue(0);

      await service.findAll(
        {
          userId: 'u1',
          action: 'create',
          resource: 'user',
          page: 2,
          limit: 10,
        },
        ADMIN_USER_ID,
      );

      expect(prisma.baseClient.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: 'u1',
            action: 'create',
            resource: 'user',
          }),
        }),
      );
    });

    it('should apply date range filters', async () => {
      prisma.baseClient.auditLog.findMany.mockResolvedValue([]);
      prisma.baseClient.auditLog.count.mockResolvedValue(0);

      await service.findAll(
        {
          from: '2024-01-01T00:00:00.000Z',
          to: '2024-12-31T00:00:00.000Z',
        },
        ADMIN_USER_ID,
      );

      expect(prisma.baseClient.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: {
              gte: expect.any(Date),
              lte: expect.any(Date),
            },
          }),
        }),
      );
    });

    it('should apply ipAddress filter', async () => {
      prisma.baseClient.auditLog.findMany.mockResolvedValue([]);
      prisma.baseClient.auditLog.count.mockResolvedValue(0);

      await service.findAll({ ipAddress: '192.168.1.1' }, ADMIN_USER_ID);

      expect(prisma.baseClient.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            ipAddress: '192.168.1.1',
          }),
        }),
      );
    });

    it('should compute pagination meta correctly', async () => {
      prisma.baseClient.auditLog.findMany.mockResolvedValue([{}, {}]);
      prisma.baseClient.auditLog.count.mockResolvedValue(25);

      const result = await service.findAll(
        { page: 2, limit: 10 },
        ADMIN_USER_ID,
      );
      expect(result.meta).toEqual({
        total: 25,
        page: 2,
        limit: 10,
        totalPages: 3,
        hasNextPage: true,
        hasPreviousPage: true,
      });
    });

    it('should filter to own logs for users without scoped permissions', async () => {
      permissionResolver.resolvePermissions.mockResolvedValue([
        'audit_logs:read',
      ]);
      prisma.baseClient.auditLog.findMany.mockResolvedValue([]);
      prisma.baseClient.auditLog.count.mockResolvedValue(0);

      await service.findAll({}, DOCTOR_USER_ID);

      expect(prisma.baseClient.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: DOCTOR_USER_ID,
          }),
        }),
      );
    });

    it('should filter to operations resources for manager', async () => {
      permissionResolver.resolvePermissions.mockResolvedValue([
        'audit_logs:read',
        'audit_logs:read:operations',
      ]);
      prisma.baseClient.auditLog.findMany.mockResolvedValue([]);
      prisma.baseClient.auditLog.count.mockResolvedValue(0);

      await service.findAll({}, MANAGER_USER_ID);

      expect(prisma.baseClient.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            resource: { in: expect.any(Array) },
          }),
        }),
      );
    });
  });

  describe('findById', () => {
    it('should return audit log with user info for admin', async () => {
      const mockLog = {
        id: 'log-1',
        action: 'create',
        resource: 'user',
        userId: 'other-user',
        user: { email: 'admin@test.com', fullName: 'Admin' },
      };
      prisma.baseClient.auditLog.findUnique.mockResolvedValue(mockLog);

      const result = await service.findById('log-1', ADMIN_USER_ID);
      expect(result).toEqual(mockLog);
      expect(prisma.baseClient.auditLog.findUnique).toHaveBeenCalledWith({
        where: { id: 'log-1' },
        include: expect.objectContaining({ user: expect.any(Object) }),
      });
    });

    it('should throw NotFoundException when not found', async () => {
      prisma.baseClient.auditLog.findUnique.mockResolvedValue(null);

      await expect(
        service.findById('missing-id', ADMIN_USER_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when doctor accesses other user log', async () => {
      permissionResolver.resolvePermissions.mockResolvedValue([
        'audit_logs:read',
      ]);
      const mockLog = {
        id: 'log-1',
        action: 'create',
        resource: 'user',
        userId: 'other-user',
      };
      prisma.baseClient.auditLog.findUnique.mockResolvedValue(mockLog);

      await expect(service.findById('log-1', DOCTOR_USER_ID)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should allow doctor to access own log', async () => {
      permissionResolver.resolvePermissions.mockResolvedValue([
        'audit_logs:read',
      ]);
      const mockLog = {
        id: 'log-1',
        action: 'create',
        resource: 'user',
        userId: DOCTOR_USER_ID,
      };
      prisma.baseClient.auditLog.findUnique.mockResolvedValue(mockLog);

      const result = await service.findById('log-1', DOCTOR_USER_ID);
      expect(result).toEqual(mockLog);
    });
  });
});
