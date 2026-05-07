import { Test } from '@nestjs/testing';
import { ProviderAvailabilityService } from './provider-availability.service';
import { PrismaService } from '@modules/database';

describe('ProviderAvailabilityService', () => {
  let service: ProviderAvailabilityService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      baseClient: {
        providerSchedule: {
          findMany: jest.fn().mockResolvedValue([]),
        },
        providerScheduleOverride: {
          findMany: jest.fn().mockResolvedValue([]),
        },
      },
    };

    const module = await Test.createTestingModule({
      providers: [
        ProviderAvailabilityService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(ProviderAvailabilityService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('getAvailability', () => {
    it('Fixture A: overlapping replacement — schedule split by override', async () => {
      prisma.baseClient.providerScheduleOverride.findMany.mockResolvedValue([
        {
          id: 'ov-1',
          overrideType: 'custom_hours',
          startTime: '10:00',
          endTime: '11:00',
        },
      ]);
      prisma.baseClient.providerSchedule.findMany.mockResolvedValue([
        { id: 's-1', startTime: '08:00', endTime: '12:00' },
        { id: 's-2', startTime: '13:00', endTime: '17:00' },
      ]);

      const result = await service.getAvailability('provider-1', '2026-05-01');

      expect(result.hasApprovedDayOff).toBe(false);
      expect(result.windows).toEqual([
        { start: '08:00', end: '10:00', source: 'schedule' },
        { start: '10:00', end: '11:00', source: 'override' },
        { start: '11:00', end: '12:00', source: 'schedule' },
        { start: '13:00', end: '17:00', source: 'schedule' },
      ]);
    });

    it('Fixture B: extension hours — override outside schedule range', async () => {
      prisma.baseClient.providerScheduleOverride.findMany.mockResolvedValue([
        {
          id: 'ov-1',
          overrideType: 'custom_hours',
          startTime: '18:00',
          endTime: '20:00',
        },
      ]);
      prisma.baseClient.providerSchedule.findMany.mockResolvedValue([
        { id: 's-1', startTime: '08:00', endTime: '12:00' },
        { id: 's-2', startTime: '13:00', endTime: '17:00' },
      ]);

      const result = await service.getAvailability('provider-1', '2026-05-01');

      expect(result.hasApprovedDayOff).toBe(false);
      expect(result.windows).toEqual([
        { start: '08:00', end: '12:00', source: 'schedule' },
        { start: '13:00', end: '17:00', source: 'schedule' },
        { start: '18:00', end: '20:00', source: 'override' },
      ]);
    });

    it('Fixture C: straddling shift boundary — override cuts across two shifts', async () => {
      prisma.baseClient.providerScheduleOverride.findMany.mockResolvedValue([
        {
          id: 'ov-1',
          overrideType: 'custom_hours',
          startTime: '11:30',
          endTime: '13:30',
        },
      ]);
      prisma.baseClient.providerSchedule.findMany.mockResolvedValue([
        { id: 's-1', startTime: '08:00', endTime: '12:00' },
        { id: 's-2', startTime: '13:00', endTime: '17:00' },
      ]);

      const result = await service.getAvailability('provider-1', '2026-05-01');

      expect(result.hasApprovedDayOff).toBe(false);
      expect(result.windows).toEqual([
        { start: '08:00', end: '11:30', source: 'schedule' },
        { start: '11:30', end: '13:30', source: 'override' },
        { start: '13:30', end: '17:00', source: 'schedule' },
      ]);
    });

    it('Fixture D: no base schedule, extension only', async () => {
      prisma.baseClient.providerScheduleOverride.findMany.mockResolvedValue([
        {
          id: 'ov-1',
          overrideType: 'custom_hours',
          startTime: '09:00',
          endTime: '12:00',
        },
      ]);
      prisma.baseClient.providerSchedule.findMany.mockResolvedValue([]);

      const result = await service.getAvailability('provider-1', '2026-05-01');

      expect(result.hasApprovedDayOff).toBe(false);
      expect(result.windows).toEqual([
        { start: '09:00', end: '12:00', source: 'override' },
      ]);
    });

    it('Fixture E: empty — no schedule, no overrides', async () => {
      prisma.baseClient.providerScheduleOverride.findMany.mockResolvedValue([]);
      prisma.baseClient.providerSchedule.findMany.mockResolvedValue([]);

      const result = await service.getAvailability('provider-1', '2026-05-01');

      expect(result.hasApprovedDayOff).toBe(false);
      expect(result.windows).toEqual([]);
    });

    it('Fixture F: day_off precedence over everything', async () => {
      prisma.baseClient.providerScheduleOverride.findMany.mockResolvedValue([
        {
          id: 'ov-1',
          overrideType: 'day_off',
          startTime: null,
          endTime: null,
        },
        {
          id: 'ov-2',
          overrideType: 'custom_hours',
          startTime: '10:00',
          endTime: '12:00',
        },
      ]);
      prisma.baseClient.providerSchedule.findMany.mockResolvedValue([
        { id: 's-1', startTime: '08:00', endTime: '17:00' },
      ]);

      const result = await service.getAvailability('provider-1', '2026-05-01');

      expect(result.hasApprovedDayOff).toBe(true);
      expect(result.windows).toEqual([]);
    });

    it('should return correct dayOfWeek from date', async () => {
      prisma.baseClient.providerScheduleOverride.findMany.mockResolvedValue([]);
      prisma.baseClient.providerSchedule.findMany.mockResolvedValue([]);

      const result = await service.getAvailability('provider-1', '2026-05-01');

      const expectedDayOfWeek = new Date('2026-05-01').getUTCDay();
      expect(result.dayOfWeek).toBe(expectedDayOfWeek);
      expect(result.providerId).toBe('provider-1');
    });
  });
});
