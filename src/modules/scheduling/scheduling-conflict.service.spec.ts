import { Test } from '@nestjs/testing';
import { SchedulingConflictService } from './scheduling-conflict.service';
import { PrismaService } from '@modules/database';

const mockAppointment = {
  id: 'apt-1',
  startTime: new Date('2026-05-18T09:00:00.000Z'),
  endTime: new Date('2026-05-18T10:00:00.000Z'),
  status: 'scheduled',
};

const mockAppointment2 = {
  id: 'apt-2',
  startTime: new Date('2026-05-18T15:00:00.000Z'),
  endTime: new Date('2026-05-18T16:00:00.000Z'),
  status: 'scheduled',
};

describe('SchedulingConflictService', () => {
  let service: SchedulingConflictService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      baseClient: {
        $queryRaw: jest.fn().mockResolvedValue([]),
        appointment: {
          findMany: jest.fn().mockResolvedValue([]),
        },
      },
    };

    const module = await Test.createTestingModule({
      providers: [
        SchedulingConflictService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(SchedulingConflictService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('validateRecurringScheduleChange', () => {
    it('should return empty when no future appointments exist', async () => {
      const result = await service.validateRecurringScheduleChange(
        'provider-1',
        1,
        '08:00',
        '17:00',
      );

      expect(result).toEqual([]);
      expect(prisma.baseClient.$queryRaw).toHaveBeenCalled();
    });

    it('should flag appointments outside new working hours', async () => {
      prisma.baseClient.$queryRaw.mockResolvedValue([
        {
          ...mockAppointment,
          startTime: new Date('2026-05-18T15:00:00.000Z'),
          endTime: new Date('2026-05-18T16:00:00.000Z'),
        },
      ]);

      const result = await service.validateRecurringScheduleChange(
        'provider-1',
        1,
        '09:00',
        '12:00',
      );

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('apt-1');
    });

    it('should not flag appointments within new working hours', async () => {
      prisma.baseClient.$queryRaw.mockResolvedValue([
        {
          ...mockAppointment,
          startTime: new Date('2026-05-18T09:00:00.000Z'),
          endTime: new Date('2026-05-18T11:00:00.000Z'),
        },
      ]);

      const result = await service.validateRecurringScheduleChange(
        'provider-1',
        1,
        '08:00',
        '12:00',
      );

      expect(result).toEqual([]);
    });

    it('should accept db parameter for transaction client', async () => {
      const mockTx = {
        $queryRaw: jest.fn().mockResolvedValue([]),
      };

      await service.validateRecurringScheduleChange(
        'provider-1',
        1,
        '08:00',
        '12:00',
        mockTx as Parameters<typeof service.validateRecurringScheduleChange>[5],
      );

      expect(mockTx.$queryRaw).toHaveBeenCalled();
      expect(prisma.baseClient.$queryRaw).not.toHaveBeenCalled();
    });
  });

  describe('validateOverrideApproval', () => {
    it('should flag all appointments for day_off', async () => {
      prisma.baseClient.appointment.findMany.mockResolvedValue([
        mockAppointment,
        mockAppointment2,
      ]);

      const result = await service.validateOverrideApproval(
        'provider-1',
        new Date('2026-05-18'),
        'day_off',
        null,
        null,
      );

      expect(result).toHaveLength(2);
    });

    it('should flag appointments outside custom_hours window', async () => {
      prisma.baseClient.appointment.findMany.mockResolvedValue([
        {
          ...mockAppointment,
          startTime: new Date('2026-05-18T07:00:00.000Z'),
          endTime: new Date('2026-05-18T08:00:00.000Z'),
        },
      ]);

      const result = await service.validateOverrideApproval(
        'provider-1',
        new Date('2026-05-18'),
        'custom_hours',
        '09:00',
        '17:00',
      );

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('apt-1');
    });

    it('should not flag appointments within custom_hours window', async () => {
      prisma.baseClient.appointment.findMany.mockResolvedValue([
        {
          ...mockAppointment,
          startTime: new Date('2026-05-18T10:00:00.000Z'),
          endTime: new Date('2026-05-18T11:00:00.000Z'),
        },
      ]);

      const result = await service.validateOverrideApproval(
        'provider-1',
        new Date('2026-05-18'),
        'custom_hours',
        '09:00',
        '12:00',
      );

      expect(result).toEqual([]);
    });

    it('should return empty array for unknown override type', async () => {
      const result = await service.validateOverrideApproval(
        'provider-1',
        new Date('2026-05-18'),
        'unknown_type',
        null,
        null,
      );

      expect(result).toEqual([]);
    });

    it('should accept db parameter for transaction client', async () => {
      const mockTx = {
        appointment: { findMany: jest.fn().mockResolvedValue([]) },
      };

      await service.validateOverrideApproval(
        'provider-1',
        new Date('2026-05-18'),
        'day_off',
        null,
        null,
        mockTx as Parameters<typeof service.validateOverrideApproval>[5],
      );

      expect(mockTx.appointment.findMany).toHaveBeenCalled();
    });
  });
});
