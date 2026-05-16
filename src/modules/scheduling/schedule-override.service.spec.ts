import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ScheduleOverrideService } from './schedule-override.service';
import { PrismaService } from '@modules/database';
import { AuditService } from '@modules/audit';
import { AppConfigService } from '@modules/config';
import { SchedulingConflictService } from './scheduling-conflict.service';
import { SchedulingGateway } from './scheduling.gateway';
import { mockI18nContext } from '@common/test/i18n-mock';

const mockUser = {
  id: 'user-1',
  email: 'doctor@test.com',
  fullName: 'Test Doctor',
  isActive: true,
};
const mockOverride = {
  id: 'override-1',
  providerId: 'provider-1',
  requestedBy: 'user-1',
  specificDate: new Date('2030-05-17T00:00:00.000Z'),
  overrideType: 'custom_hours',
  startTime: '10:00',
  endTime: '12:00',
  reason: 'Personal appointment',
  status: 'pending',
  requestedAt: new Date(),
  reviewedBy: null,
  reviewedAt: null,
  reviewNote: null,
  targetScheduleId: null,
};

describe('ScheduleOverrideService', () => {
  let service: ScheduleOverrideService;
  let prisma: any;
  let auditService: any;
  let conflictService: any;
  let gateway: any;

  beforeEach(async () => {
    mockI18nContext();

    prisma = {
      baseClient: {
        providerScheduleOverride: {
          findMany: jest.fn().mockResolvedValue([]),
          count: jest.fn().mockResolvedValue(0),
          findUnique: jest.fn(),
          findFirst: jest.fn(),
          create: jest.fn(),
          update: jest.fn(),
        },
        provider: {
          findFirst: jest.fn(),
          findUnique: jest.fn(),
        },
        providerSchedule: {
          findUnique: jest.fn(),
        },
        appointment: {
          findMany: jest.fn().mockResolvedValue([]),
        },
      },
      transaction: jest.fn((cb: any) => cb(prisma.baseClient)),
    };

    auditService = { emit: jest.fn() };
    conflictService = {
      validateOverrideApproval: jest.fn().mockResolvedValue([]),
    };
    gateway = {
      emitOverrideRequested: jest.fn(),
      emitOverrideReviewed: jest.fn(),
    };

    const module = await Test.createTestingModule({
      providers: [
        ScheduleOverrideService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: auditService },
        {
          provide: AppConfigService,
          useValue: { app: { SCHEDULE_OVERRIDE_STALE_DAYS: 3 } },
        },
        { provide: SchedulingConflictService, useValue: conflictService },
        { provide: SchedulingGateway, useValue: gateway },
      ],
    }).compile();

    service = module.get(ScheduleOverrideService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('assertOwnProvider', () => {
    it('should pass when provider belongs to current user', async () => {
      prisma.baseClient.provider.findFirst.mockResolvedValue({
        id: 'provider-1',
      });

      await expect(
        service.assertOwnProvider(mockUser, 'provider-1'),
      ).resolves.toBeUndefined();
    });

    it('should throw ForbiddenException when provider does not belong to user', async () => {
      prisma.baseClient.provider.findFirst.mockResolvedValue(null);

      await expect(
        service.assertOwnProvider(mockUser, 'provider-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException when provider id mismatch', async () => {
      prisma.baseClient.provider.findFirst.mockResolvedValue({
        id: 'provider-2',
      });

      await expect(
        service.assertOwnProvider(mockUser, 'provider-1'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('create', () => {
    it('should create a pending override for custom_hours', async () => {
      prisma.baseClient.providerScheduleOverride.create.mockResolvedValue(
        mockOverride,
      );

      const result = await service.create(
        {
          providerId: 'provider-1',
          specificDate: new Date('2030-05-17'),
          overrideType: 'custom_hours',
          startTime: '10:00',
          endTime: '12:00',
          reason: 'Personal appointment',
        },
        mockUser,
      );

      expect(result.status).toBe('pending');
      expect(result.requestedBy).toBe('user-1');
      expect(
        prisma.baseClient.providerScheduleOverride.create,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'pending',
            requestedBy: 'user-1',
          }),
        }),
      );
    });

    it('should create a pending override for day_off with null times', async () => {
      prisma.baseClient.providerScheduleOverride.create.mockResolvedValue({
        ...mockOverride,
        overrideType: 'day_off',
        startTime: null,
        endTime: null,
      });

      const result = await service.create(
        {
          providerId: 'provider-1',
          specificDate: new Date('2030-05-17'),
          overrideType: 'day_off',
          reason: 'Vacation',
        },
        mockUser,
      );

      expect(result.overrideType).toBe('day_off');
    });

    it('should throw BadRequestException when date is today or in the past', async () => {
      await expect(
        service.create(
          {
            providerId: 'provider-1',
            specificDate: new Date('2024-01-01'),
            overrideType: 'day_off',
            reason: 'Old date',
          },
          mockUser,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should emit override.requested event via gateway', async () => {
      prisma.baseClient.providerScheduleOverride.create.mockResolvedValue(
        mockOverride,
      );

      await service.create(
        {
          providerId: 'provider-1',
          specificDate: new Date('2030-05-17'),
          overrideType: 'custom_hours',
          startTime: '10:00',
          endTime: '12:00',
          reason: 'Personal appointment',
        },
        mockUser,
      );

      expect(gateway.emitOverrideRequested).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'override-1',
          providerId: 'provider-1',
        }),
      );
    });

    it('should create override with valid targetScheduleId', async () => {
      // 2030-05-17 is a Friday — UTC day 5
      prisma.baseClient.providerSchedule.findUnique.mockResolvedValue({
        id: 'schedule-1',
        providerId: 'provider-1',
        dayOfWeek: 5,
        isAvailable: true,
      });
      prisma.baseClient.providerScheduleOverride.create.mockResolvedValue({
        ...mockOverride,
        targetScheduleId: 'schedule-1',
      });

      const result = await service.create(
        {
          providerId: 'provider-1',
          specificDate: new Date('2030-05-17'),
          overrideType: 'day_off',
          targetScheduleId: 'schedule-1',
        },
        mockUser,
      );

      expect(result.targetScheduleId).toBe('schedule-1');
    });

    it('should throw BadRequestException when targetScheduleId has mismatched day-of-week', async () => {
      // 2030-05-17 is Friday (DOW 5), but shift is on Monday (DOW 1)
      prisma.baseClient.providerSchedule.findUnique.mockResolvedValue({
        id: 'schedule-1',
        providerId: 'provider-1',
        dayOfWeek: 1,
        isAvailable: true,
      });

      await expect(
        service.create(
          {
            providerId: 'provider-1',
            specificDate: new Date('2030-05-17'),
            overrideType: 'day_off',
            targetScheduleId: 'schedule-1',
          },
          mockUser,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when targetScheduleId has mismatched provider', async () => {
      // shift belongs to a different provider
      prisma.baseClient.providerSchedule.findUnique.mockResolvedValue({
        id: 'schedule-1',
        providerId: 'provider-2',
        dayOfWeek: 5,
        isAvailable: true,
      });

      await expect(
        service.create(
          {
            providerId: 'provider-1',
            specificDate: new Date('2030-05-17'),
            overrideType: 'day_off',
            targetScheduleId: 'schedule-1',
          },
          mockUser,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findById', () => {
    it('should return override by id', async () => {
      prisma.baseClient.providerScheduleOverride.findUnique.mockResolvedValue(
        mockOverride,
      );

      const result = await service.findById('override-1');
      expect(result).toEqual(mockOverride);
    });

    it('should throw NotFoundException when not found', async () => {
      prisma.baseClient.providerScheduleOverride.findUnique.mockResolvedValue(
        null,
      );

      await expect(service.findById('unknown')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findAll', () => {
    it('should return paginated results', async () => {
      prisma.baseClient.providerScheduleOverride.findMany.mockResolvedValue([
        mockOverride,
      ]);
      prisma.baseClient.providerScheduleOverride.count.mockResolvedValue(1);

      const result = await service.findAll({ page: 1, limit: 10 });
      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
    });

    it('should filter by providerId', async () => {
      prisma.baseClient.providerScheduleOverride.findMany.mockResolvedValue([]);
      prisma.baseClient.providerScheduleOverride.count.mockResolvedValue(0);

      await service.findAll({ page: 1, limit: 10, providerId: 'provider-1' });

      expect(
        prisma.baseClient.providerScheduleOverride.findMany,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ providerId: 'provider-1' }),
        }),
      );
    });
  });

  describe('findPending', () => {
    it('should return only pending overrides', async () => {
      prisma.baseClient.providerScheduleOverride.findMany.mockResolvedValue([
        mockOverride,
      ]);
      prisma.baseClient.providerScheduleOverride.count.mockResolvedValue(1);

      await service.findPending({ page: 1, limit: 10 });

      expect(
        prisma.baseClient.providerScheduleOverride.findMany,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'pending' }),
        }),
      );
    });
  });

  describe('findMine', () => {
    it('should return overrides for the current user provider', async () => {
      prisma.baseClient.provider.findFirst.mockResolvedValue({
        id: 'provider-1',
      });
      prisma.baseClient.providerScheduleOverride.findMany.mockResolvedValue([
        mockOverride,
      ]);
      prisma.baseClient.providerScheduleOverride.count.mockResolvedValue(1);

      const result = await service.findMine(mockUser, {
        page: 1,
        limit: 10,
      });

      expect(result.data).toHaveLength(1);
      expect(
        prisma.baseClient.providerScheduleOverride.findMany,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ providerId: 'provider-1' }),
        }),
      );
    });
  });

  describe('review', () => {
    beforeEach(() => {
      prisma.baseClient.providerScheduleOverride.findUnique.mockResolvedValue(
        mockOverride,
      );
    });

    it('should approve an override', async () => {
      const result = await service.review(
        'override-1',
        { decision: 'approve' },
        mockUser,
      );

      expect(result.status).toBe('approved');
    });

    it('should reject an override', async () => {
      const result = await service.review(
        'override-1',
        { decision: 'reject', reviewNote: 'Not needed' },
        mockUser,
      );

      expect(result.status).toBe('rejected');
    });

    it('should emit SCHEDULE_OVERRIDE_APPROVED on approve', async () => {
      await service.review('override-1', { decision: 'approve' }, mockUser);

      expect(auditService.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'SCHEDULE_OVERRIDE_APPROVED',
          resource: 'schedule_override',
          resourceId: 'override-1',
        }),
      );
    });

    it('should emit SCHEDULE_OVERRIDE_REJECTED on reject with reviewNote as reason', async () => {
      await service.review(
        'override-1',
        { decision: 'reject', reviewNote: 'No approval needed' },
        mockUser,
      );

      expect(auditService.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'SCHEDULE_OVERRIDE_REJECTED',
          resource: 'schedule_override',
          resourceId: 'override-1',
          reason: 'No approval needed',
        }),
      );
    });

    it('should throw ConflictException when conflicting appointments exist on approve', async () => {
      conflictService.validateOverrideApproval.mockResolvedValue([
        {
          id: 'apt-1',
          startTime: new Date('2030-05-17T10:30:00'),
          endTime: new Date('2030-05-17T11:30:00'),
          status: 'scheduled',
        },
      ]);

      await expect(
        service.review('override-1', { decision: 'approve' }, mockUser),
      ).rejects.toThrow(ConflictException);
    });

    it('should emit override.reviewed on approve', async () => {
      await service.review('override-1', { decision: 'approve' }, mockUser);

      expect(gateway.emitOverrideReviewed).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'override-1',
          status: 'approved',
          reviewerId: 'user-1',
        }),
      );
    });

    it('should reject without reviewNote (no validation at service level)', async () => {
      const result = await service.review(
        'override-1',
        { decision: 'reject' },
        mockUser,
      );

      expect(result.status).toBe('rejected');
    });
  });

  describe('cancel', () => {
    it('should cancel a pending override by owner', async () => {
      prisma.baseClient.providerScheduleOverride.findUnique.mockResolvedValue(
        mockOverride,
      );
      prisma.baseClient.provider.findFirst.mockResolvedValue({
        id: 'provider-1',
      });
      prisma.baseClient.providerScheduleOverride.update.mockResolvedValue({
        ...mockOverride,
        status: 'cancelled',
      });

      const result = await service.cancel('override-1', mockUser);

      expect(result.status).toBe('cancelled');
    });

    it('should throw BadRequestException when status is not pending', async () => {
      prisma.baseClient.providerScheduleOverride.findUnique.mockResolvedValue({
        ...mockOverride,
        status: 'approved',
      });

      await expect(service.cancel('override-1', mockUser)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw ForbiddenException when user is not the requester and not the provider', async () => {
      prisma.baseClient.providerScheduleOverride.findUnique.mockResolvedValue({
        ...mockOverride,
        requestedBy: 'user-2',
      });
      prisma.baseClient.provider.findFirst.mockResolvedValue({
        id: 'provider-3',
      });

      await expect(service.cancel('override-1', mockUser)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
