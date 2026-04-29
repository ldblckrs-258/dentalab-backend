import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { AuditService } from './audit.service';
import { PrismaService } from '@modules/database';
import { QueueProducerService } from '@modules/queue/queue-producer.service';
import { AppConfigService } from '@modules/config';

describe('AuditService', () => {
  let service: AuditService;
  let prisma: any;
  let permissionResolver: any;
  let queueProducer: { publishToExchange: jest.Mock };
  let config: { queue: { AUDIT_REDACTION_HMAC_KEY: string } };

  const ADMIN_USER_ID = 'admin-1';
  const MANAGER_USER_ID = 'manager-1';
  const DOCTOR_USER_ID = 'doctor-1';

  beforeEach(async () => {
    prisma = {
      baseClient: {
        auditLog: {
          findMany: jest.fn().mockResolvedValue([]),
          findFirst: jest.fn(),
          count: jest.fn().mockResolvedValue(0),
        },
      },
    };

    permissionResolver = {
      resolvePermissions: jest
        .fn()
        .mockResolvedValue(['audit_logs:read', 'audit_logs:read:all']),
    };

    queueProducer = { publishToExchange: jest.fn() };

    config = {
      queue: { AUDIT_REDACTION_HMAC_KEY: 'test-hmac-key' },
    };

    const moduleRef = {
      get: jest.fn().mockReturnValue(permissionResolver),
    };

    const module = await Test.createTestingModule({
      providers: [
        AuditService,
        { provide: PrismaService, useValue: prisma },
        { provide: QueueProducerService, useValue: queueProducer },
        { provide: AppConfigService, useValue: config },
        { provide: ModuleRef, useValue: moduleRef },
      ],
    }).compile();

    service = module.get(AuditService);
    service.onModuleInit();
  });

  describe('emit', () => {
    it('should reject when reasonRequired and reason missing', () => {
      expect(() =>
        service.emit({
          code: 'CLINICAL_NOTE_VIEWED',
          resource: 'clinical_note',
          resourceId: 'x',
        }),
      ).toThrow(BadRequestException);
    });

    it('should publish when valid', async () => {
      service.emit({ code: 'AUTH_LOGIN_SUCCESS' });
      await new Promise<void>((r) => setImmediate(r));
      expect(queueProducer.publishToExchange).toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('should return paginated result', async () => {
      prisma.baseClient.auditLog.findMany.mockResolvedValue([]);
      prisma.baseClient.auditLog.count.mockResolvedValue(0);

      const result = await service.findAll({}, ADMIN_USER_ID);
      expect(prisma.baseClient.auditLog.findMany).toHaveBeenCalled();
      expect(result.meta.page).toBe(1);
    });

    it('should apply actorId filter', async () => {
      prisma.baseClient.auditLog.findMany.mockResolvedValue([]);
      prisma.baseClient.auditLog.count.mockResolvedValue(0);

      await service.findAll(
        { actorId: 'u1', eventCode: 'USER_CREATED' },
        ADMIN_USER_ID,
      );

      expect(prisma.baseClient.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            actorId: 'u1',
            eventCode: 'USER_CREATED',
          }),
        }),
      );
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
            actorId: DOCTOR_USER_ID,
          }),
        }),
      );
    });

    it('should exclude phi for users without phi or all permission', async () => {
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
            category: { not: 'phi' },
          }),
        }),
      );
    });
  });

  describe('findById', () => {
    it('should return audit log for admin', async () => {
      const mockLog = {
        id: 'log-1',
        eventCode: 'USER_CREATED',
        resource: 'user',
        actorId: 'other-user',
        category: 'ops',
      };
      prisma.baseClient.auditLog.findFirst.mockResolvedValue(mockLog);

      const result = await service.findById('log-1', ADMIN_USER_ID);
      expect(result).toEqual(mockLog);
      expect(prisma.baseClient.auditLog.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'log-1' },
        }),
      );
    });

    it('should throw NotFoundException when not found', async () => {
      prisma.baseClient.auditLog.findFirst.mockResolvedValue(null);

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
        eventCode: 'USER_CREATED',
        resource: 'user',
        actorId: 'other-user',
        category: 'ops',
      };
      prisma.baseClient.auditLog.findFirst.mockResolvedValue(mockLog);

      await expect(service.findById('log-1', DOCTOR_USER_ID)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw when non-phi user accesses phi log', async () => {
      permissionResolver.resolvePermissions.mockResolvedValue([
        'audit_logs:read',
        'audit_logs:read:operations',
      ]);
      prisma.baseClient.auditLog.findFirst.mockResolvedValue({
        id: 'log-1',
        category: 'phi',
        actorId: 'x',
      });

      await expect(service.findById('log-1', MANAGER_USER_ID)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
