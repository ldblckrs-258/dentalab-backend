import { Test } from '@nestjs/testing';
import { ScheduleOverviewService } from './schedule-overview.service';
import { PrismaService } from '@modules/database';
import { AppConfigService } from '@modules/config';

const mockProvider = {
  id: 'provider-1',
  specialty: 'General Dentistry',
  user: {
    fullName: 'Dr. Smith',
    avatarUrl: 'https://example.com/avatar.png',
  },
};

const mockSchedule = {
  id: 'sched-1',
  providerId: 'provider-1',
  dayOfWeek: 1,
  startTime: '08:00',
  endTime: '12:00',
  isAvailable: true,
};

const mockOverride = {
  id: 'override-1',
  providerId: 'provider-1',
  specificDate: new Date('2026-05-15'),
  overrideType: 'day_off',
  startTime: null,
  endTime: null,
  status: 'pending',
  requestedBy: 'user-1',
  requestedAt: new Date(),
  reviewedBy: null,
  reviewedAt: null,
  reviewNote: null,
  reason: 'Vacation',
};

describe('ScheduleOverviewService', () => {
  let service: ScheduleOverviewService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      baseClient: {
        provider: {
          findMany: jest.fn(),
        },
        providerSchedule: {
          findMany: jest.fn(),
        },
        providerScheduleOverride: {
          findMany: jest.fn(),
        },
        appointment: {
          findMany: jest.fn().mockResolvedValue([]),
        },
      },
    };

    const config = {
      app: { SCHEDULE_OVERRIDE_STALE_DAYS: 3 },
    };

    const module = await Test.createTestingModule({
      providers: [
        ScheduleOverviewService,
        { provide: PrismaService, useValue: prisma },
        { provide: AppConfigService, useValue: config },
      ],
    }).compile();

    service = module.get(ScheduleOverviewService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('getScheduleOverview', () => {
    it('should return all data needed for schedule overview', async () => {
      prisma.baseClient.provider.findMany.mockResolvedValue([mockProvider]);
      prisma.baseClient.providerSchedule.findMany.mockResolvedValue([
        mockSchedule,
      ]);
      prisma.baseClient.providerScheduleOverride.findMany.mockResolvedValue([
        mockOverride,
      ]);
      prisma.baseClient.appointment.findMany.mockResolvedValue([]);

      const result = await service.getScheduleOverview({
        from: '2026-05-10',
        to: '2026-05-20',
      });

      expect(result.providers).toHaveLength(1);
      expect(result.providers[0].fullName).toBe('Dr. Smith');
      expect(result.providers[0].specialty).toBe('General Dentistry');
      expect(result.schedules).toHaveLength(1);
      expect(result.overrides).toHaveLength(1);
    });

    it('should filter providers by providerId', async () => {
      prisma.baseClient.provider.findMany.mockResolvedValue([mockProvider]);
      prisma.baseClient.providerSchedule.findMany.mockResolvedValue([]);
      prisma.baseClient.providerScheduleOverride.findMany.mockResolvedValue([]);
      prisma.baseClient.appointment.findMany.mockResolvedValue([]);

      await service.getScheduleOverview({
        from: '2026-05-10',
        to: '2026-05-20',
        providerId: ['provider-1'],
      });

      expect(prisma.baseClient.provider.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: { in: ['provider-1'] } }),
        }),
      );
    });

    it('should filter providers by specialty', async () => {
      prisma.baseClient.provider.findMany.mockResolvedValue([mockProvider]);
      prisma.baseClient.providerSchedule.findMany.mockResolvedValue([]);
      prisma.baseClient.providerScheduleOverride.findMany.mockResolvedValue([]);
      prisma.baseClient.appointment.findMany.mockResolvedValue([]);

      await service.getScheduleOverview({
        from: '2026-05-10',
        to: '2026-05-20',
        specialty: ['General Dentistry'],
      });

      expect(prisma.baseClient.provider.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            specialty: { in: ['General Dentistry'] },
          }),
        }),
      );
    });

    it('should filter overrides by status', async () => {
      prisma.baseClient.provider.findMany.mockResolvedValue([mockProvider]);
      prisma.baseClient.providerSchedule.findMany.mockResolvedValue([]);
      prisma.baseClient.providerScheduleOverride.findMany.mockResolvedValue([
        mockOverride,
      ]);
      prisma.baseClient.appointment.findMany.mockResolvedValue([]);

      await service.getScheduleOverview({
        from: '2026-05-10',
        to: '2026-05-20',
        overrideStatus: ['pending'],
      });

      expect(
        prisma.baseClient.providerScheduleOverride.findMany,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: { in: ['pending'] } }),
        }),
      );
    });

    it('should mark pending overrides older than threshold as stale', async () => {
      prisma.baseClient.provider.findMany.mockResolvedValue([mockProvider]);
      prisma.baseClient.providerSchedule.findMany.mockResolvedValue([]);
      prisma.baseClient.providerScheduleOverride.findMany.mockResolvedValue([
        {
          ...mockOverride,
          requestedAt: new Date('2026-01-01'),
          status: 'pending',
        },
      ]);
      prisma.baseClient.appointment.findMany.mockResolvedValue([]);

      const result = await service.getScheduleOverview({
        from: '2026-05-10',
        to: '2026-05-20',
      });

      expect(result.overrides[0].isStale).toBe(true);
    });

    it('should not mark non-pending overrides as stale', async () => {
      prisma.baseClient.provider.findMany.mockResolvedValue([mockProvider]);
      prisma.baseClient.providerSchedule.findMany.mockResolvedValue([]);
      prisma.baseClient.providerScheduleOverride.findMany.mockResolvedValue([
        {
          ...mockOverride,
          requestedAt: new Date('2026-01-01'),
          status: 'approved',
        },
      ]);
      prisma.baseClient.appointment.findMany.mockResolvedValue([]);

      const result = await service.getScheduleOverview({
        from: '2026-05-10',
        to: '2026-05-20',
      });

      expect(result.overrides[0].isStale).toBe(false);
    });

    it('should return appointment counts per provider per day', async () => {
      prisma.baseClient.provider.findMany.mockResolvedValue([mockProvider]);
      prisma.baseClient.providerSchedule.findMany.mockResolvedValue([]);
      prisma.baseClient.providerScheduleOverride.findMany.mockResolvedValue([]);
      prisma.baseClient.appointment.findMany.mockResolvedValue([
        {
          providerId: 'provider-1',
          startTime: new Date('2026-05-15T09:00:00.000Z'),
        },
        {
          providerId: 'provider-1',
          startTime: new Date('2026-05-15T10:00:00.000Z'),
        },
        {
          providerId: 'provider-1',
          startTime: new Date('2026-05-15T11:00:00.000Z'),
        },
      ]);

      const result = await service.getScheduleOverview({
        from: '2026-05-10',
        to: '2026-05-20',
      });

      expect(result.appointmentCounts).toHaveLength(1);
      expect(result.appointmentCounts[0].providerId).toBe('provider-1');
      expect(result.appointmentCounts[0].date).toBe('2026-05-15');
      expect(result.appointmentCounts[0].count).toBe(3);
    });

    it('should return empty arrays when no providers found', async () => {
      prisma.baseClient.provider.findMany.mockResolvedValue([]);
      prisma.baseClient.providerSchedule.findMany.mockResolvedValue([]);
      prisma.baseClient.providerScheduleOverride.findMany.mockResolvedValue([]);
      prisma.baseClient.appointment.findMany.mockResolvedValue([]);

      const result = await service.getScheduleOverview({
        from: '2026-05-10',
        to: '2026-05-20',
      });

      expect(result.providers).toHaveLength(0);
      expect(result.schedules).toHaveLength(0);
      expect(result.overrides).toHaveLength(0);
      expect(result.appointmentCounts).toHaveLength(0);
    });

    it('should only include active providers', async () => {
      prisma.baseClient.provider.findMany.mockResolvedValue([mockProvider]);
      prisma.baseClient.providerSchedule.findMany.mockResolvedValue([]);
      prisma.baseClient.providerScheduleOverride.findMany.mockResolvedValue([]);
      prisma.baseClient.appointment.findMany.mockResolvedValue([]);

      await service.getScheduleOverview({
        from: '2026-05-10',
        to: '2026-05-20',
      });

      expect(prisma.baseClient.provider.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isActive: true }),
        }),
      );
    });

    it('should normalize override dates to ISO strings', async () => {
      prisma.baseClient.provider.findMany.mockResolvedValue([mockProvider]);
      prisma.baseClient.providerSchedule.findMany.mockResolvedValue([]);
      prisma.baseClient.providerScheduleOverride.findMany.mockResolvedValue([
        mockOverride,
      ]);
      prisma.baseClient.appointment.findMany.mockResolvedValue([]);

      const result = await service.getScheduleOverview({
        from: '2026-05-10',
        to: '2026-05-20',
      });

      expect(typeof result.overrides[0].specificDate).toBe('string');
      expect(typeof result.overrides[0].requestedAt).toBe('string');
      expect(result.overrides[0].reviewedAt).toBeNull();
    });
  });
});
