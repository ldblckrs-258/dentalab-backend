import { PrismaService } from '@modules/database';
import { Test } from '@nestjs/testing';
import type { Prisma } from '@prisma/client';
import { SchedulingConflictService } from './scheduling-conflict.service';

// Clinic-local Mon 09:00-10:00 (Asia/Saigon) == UTC 02:00-03:00.
const mockAppointment = {
  id: 'apt-1',
  startTime: new Date('2026-05-18T02:00:00.000Z'),
  endTime: new Date('2026-05-18T03:00:00.000Z'),
  status: 'scheduled',
};

// Clinic-local Mon 15:00-16:00 == UTC 08:00-09:00.
const mockAppointment2 = {
  id: 'apt-2',
  startTime: new Date('2026-05-18T08:00:00.000Z'),
  endTime: new Date('2026-05-18T09:00:00.000Z'),
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
        providerSchedule: {
          findUnique: jest.fn(),
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
      // Clinic-local Mon 09:00-11:00 (UTC 02:00-04:00) inside shift 08:00-12:00.
      prisma.baseClient.$queryRaw.mockResolvedValue([
        {
          ...mockAppointment,
          startTime: new Date('2026-05-18T02:00:00.000Z'),
          endTime: new Date('2026-05-18T04:00:00.000Z'),
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
        mockTx as unknown as Prisma.TransactionClient,
      );

      expect(mockTx.$queryRaw).toHaveBeenCalled();
      expect(prisma.baseClient.$queryRaw).not.toHaveBeenCalled();
    });
  });

  describe('validateBulkRecurringSchedules', () => {
    it('does not flag an appointment booked inside a clinic-local shift when adding a new shift', async () => {
      // Clinic-local Mon 09:00-10:00 (UTC 02:00-03:00) sits inside the existing
      // 08:00-12:00 shift; adding a 13:00-17:00 shift must not orphan it.
      prisma.baseClient.$queryRaw.mockResolvedValue([
        {
          id: 'apt-1',
          startTime: new Date('2026-05-18T02:00:00.000Z'),
          endTime: new Date('2026-05-18T03:00:00.000Z'),
          status: 'scheduled',
        },
      ]);

      const result = await service.validateBulkRecurringSchedules(
        'provider-1',
        [
          { dayOfWeek: 1, startTime: '08:00', endTime: '12:00' },
          { dayOfWeek: 1, startTime: '13:00', endTime: '17:00' },
        ],
      );

      expect(result).toEqual([]);
    });

    it('flags an appointment that falls outside every shift', async () => {
      // Clinic-local Mon 18:00-19:00 (UTC 11:00-12:00) is outside both shifts.
      prisma.baseClient.$queryRaw.mockResolvedValue([
        {
          id: 'apt-late',
          startTime: new Date('2026-05-18T11:00:00.000Z'),
          endTime: new Date('2026-05-18T12:00:00.000Z'),
          status: 'scheduled',
        },
      ]);

      const result = await service.validateBulkRecurringSchedules(
        'provider-1',
        [
          { dayOfWeek: 1, startTime: '08:00', endTime: '12:00' },
          { dayOfWeek: 1, startTime: '13:00', endTime: '17:00' },
        ],
      );

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('apt-late');
    });

    it('buckets the appointment by clinic-local day, not UTC day', async () => {
      // UTC Sun 18:30 is clinic-local Mon 01:30 — must match the Monday shift.
      prisma.baseClient.$queryRaw.mockResolvedValue([
        {
          id: 'apt-cross',
          startTime: new Date('2026-05-17T18:30:00.000Z'),
          endTime: new Date('2026-05-17T19:30:00.000Z'),
          status: 'scheduled',
        },
      ]);

      const result = await service.validateBulkRecurringSchedules(
        'provider-1',
        [{ dayOfWeek: 1, startTime: '00:00', endTime: '08:00' }],
      );

      expect(result).toEqual([]);
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
      // Clinic-local Mon 07:00-08:00 (UTC 00:00-01:00), before the 09:00 window.
      prisma.baseClient.appointment.findMany.mockResolvedValue([
        {
          ...mockAppointment,
          startTime: new Date('2026-05-18T00:00:00.000Z'),
          endTime: new Date('2026-05-18T01:00:00.000Z'),
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
      // Clinic-local Mon 10:00-11:00 (UTC 03:00-04:00), inside the 09:00-12:00 window.
      prisma.baseClient.appointment.findMany.mockResolvedValue([
        {
          ...mockAppointment,
          startTime: new Date('2026-05-18T03:00:00.000Z'),
          endTime: new Date('2026-05-18T04:00:00.000Z'),
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
        providerSchedule: { findUnique: jest.fn() },
      };

      await service.validateOverrideApproval(
        'provider-1',
        new Date('2026-05-18'),
        'day_off',
        null,
        null,
        mockTx as unknown as Prisma.TransactionClient,
      );

      expect(mockTx.appointment.findMany).toHaveBeenCalled();
    });

    it('should only flag appointments within targeted shift for day_off with targetScheduleId', async () => {
      prisma.baseClient.appointment.findMany.mockResolvedValue([
        mockAppointment, // 09:00-10:00 — within shift 08:00-12:00
        mockAppointment2, // 15:00-16:00 — outside shift 08:00-12:00
      ]);
      prisma.baseClient.providerSchedule.findUnique.mockResolvedValue({
        id: 'schedule-1',
        startTime: '08:00',
        endTime: '12:00',
      });

      const result = await service.validateOverrideApproval(
        'provider-1',
        new Date('2026-05-18'),
        'day_off',
        null,
        null,
        undefined,
        'schedule-1',
      );

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('apt-1');
    });

    it('should return empty when targetScheduleId shift is not found', async () => {
      prisma.baseClient.appointment.findMany.mockResolvedValue([
        mockAppointment,
      ]);
      prisma.baseClient.providerSchedule.findUnique.mockResolvedValue(null);

      const result = await service.validateOverrideApproval(
        'provider-1',
        new Date('2026-05-18'),
        'day_off',
        null,
        null,
        undefined,
        'nonexistent-schedule',
      );

      expect(result).toEqual([]);
    });
  });
});
