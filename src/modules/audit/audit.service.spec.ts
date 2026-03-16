import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { AuditService } from './audit.service';
import { PrismaService } from '@modules/database';

describe('AuditService', () => {
  let service: AuditService;

  let prisma: any;

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

    const module = await Test.createTestingModule({
      providers: [AuditService, { provide: PrismaService, useValue: prisma }],
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
          user_id: 'u1',
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

      const result = await service.findAll({});
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

      await service.findAll({
        userId: 'u1',
        action: 'create',
        resource: 'user',
        page: 2,
        limit: 10,
      });

      expect(prisma.baseClient.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            user_id: 'u1',
            action: 'create',
            resource: 'user',
          }),
        }),
      );
    });

    it('should apply date range filters', async () => {
      prisma.baseClient.auditLog.findMany.mockResolvedValue([]);
      prisma.baseClient.auditLog.count.mockResolvedValue(0);

      await service.findAll({
        from: '2024-01-01T00:00:00.000Z',
        to: '2024-12-31T00:00:00.000Z',
      });

      expect(prisma.baseClient.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            created_at: {
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

      await service.findAll({ ipAddress: '192.168.1.1' });

      expect(prisma.baseClient.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            ip_address: '192.168.1.1',
          }),
        }),
      );
    });

    it('should compute pagination meta correctly', async () => {
      prisma.baseClient.auditLog.findMany.mockResolvedValue([{}, {}]);
      prisma.baseClient.auditLog.count.mockResolvedValue(25);

      const result = await service.findAll({ page: 2, limit: 10 });
      expect(result.meta).toEqual({
        total: 25,
        page: 2,
        limit: 10,
        totalPages: 3,
        hasNextPage: true,
        hasPreviousPage: true,
      });
    });
  });

  describe('findById', () => {
    it('should return audit log with user info', async () => {
      const mockLog = {
        id: 'log-1',
        action: 'create',
        resource: 'user',
        user: { email: 'admin@test.com', full_name: 'Admin' },
      };
      prisma.baseClient.auditLog.findUnique.mockResolvedValue(mockLog);

      const result = await service.findById('log-1');
      expect(result).toEqual(mockLog);
      expect(prisma.baseClient.auditLog.findUnique).toHaveBeenCalledWith({
        where: { id: 'log-1' },
        include: expect.objectContaining({ user: expect.any(Object) }),
      });
    });

    it('should throw NotFoundException when not found', async () => {
      prisma.baseClient.auditLog.findUnique.mockResolvedValue(null);

      await expect(service.findById('missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
