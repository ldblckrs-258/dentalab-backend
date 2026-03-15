import { Test } from '@nestjs/testing';
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
    it('should apply pagination defaults', async () => {
      prisma.baseClient.auditLog.findMany.mockResolvedValue([]);
      prisma.baseClient.auditLog.count.mockResolvedValue(0);

      const result = await service.findAll({});
      expect(prisma.baseClient.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 20 }),
      );
      expect(result.meta.page).toBe(1);
      expect(result.meta.limit).toBe(20);
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
          skip: 10,
          take: 10,
        }),
      );
    });

    it('should apply date range filters', async () => {
      const start = new Date('2024-01-01');
      const end = new Date('2024-12-31');
      prisma.baseClient.auditLog.findMany.mockResolvedValue([]);
      prisma.baseClient.auditLog.count.mockResolvedValue(0);

      await service.findAll({ startDate: start, endDate: end });

      expect(prisma.baseClient.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            created_at: { gte: start, lte: end },
          },
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
});
