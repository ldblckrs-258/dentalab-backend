import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ProviderScheduleService } from './provider-schedule.service';
import { PrismaService } from '@modules/database';
import { InfrastructureException } from '@modules/common/filters/infrastructure.exception';
import { mockI18nContext } from '@common/test/i18n-mock';

const mockSchedule = {
  id: 'sched-1',
  providerId: 'provider-1',
  dayOfWeek: 1,
  startTime: '08:00',
  endTime: '12:00',
  isAvailable: true,
};

const mockSchedule2 = {
  id: 'sched-2',
  providerId: 'provider-1',
  dayOfWeek: 1,
  startTime: '13:00',
  endTime: '17:00',
  isAvailable: true,
};

describe('ProviderScheduleService', () => {
  let service: ProviderScheduleService;
  let prisma: any;

  beforeEach(async () => {
    mockI18nContext();

    prisma = {
      baseClient: {
        providerSchedule: {
          findMany: jest.fn().mockResolvedValue([]),
          count: jest.fn().mockResolvedValue(0),
          findUnique: jest.fn(),
          create: jest.fn(),
          update: jest.fn(),
          delete: jest.fn(),
        },
        provider: {
          findUnique: jest.fn(),
        },
        appointment: {
          findMany: jest.fn().mockResolvedValue([]),
        },
      },
    };

    const module = await Test.createTestingModule({
      providers: [
        ProviderScheduleService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(ProviderScheduleService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('findForProvider', () => {
    it('should return schedules for a provider', async () => {
      prisma.baseClient.providerSchedule.findMany.mockResolvedValue([
        mockSchedule,
        mockSchedule2,
      ]);

      const result = await service.findForProvider('provider-1');

      expect(result).toHaveLength(2);
      expect(prisma.baseClient.providerSchedule.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { providerId: 'provider-1' },
          orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
        }),
      );
    });

    it('should filter only available when onlyAvailable=true', async () => {
      prisma.baseClient.providerSchedule.findMany.mockResolvedValue([
        mockSchedule,
      ]);

      await service.findForProvider('provider-1', true);

      expect(prisma.baseClient.providerSchedule.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { providerId: 'provider-1', isAvailable: true },
        }),
      );
    });
  });

  describe('findAll', () => {
    it('should return paginated results', async () => {
      prisma.baseClient.providerSchedule.findMany.mockResolvedValue([
        mockSchedule,
      ]);
      prisma.baseClient.providerSchedule.count.mockResolvedValue(1);

      const result = await service.findAll({ page: 1, limit: 10 });

      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
    });

    it('should filter by providerId', async () => {
      prisma.baseClient.providerSchedule.findMany.mockResolvedValue([]);
      prisma.baseClient.providerSchedule.count.mockResolvedValue(0);

      await service.findAll({ page: 1, limit: 10, providerId: 'provider-1' });

      expect(prisma.baseClient.providerSchedule.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ providerId: 'provider-1' }),
        }),
      );
    });
  });

  describe('create', () => {
    it('should create a schedule block', async () => {
      prisma.baseClient.provider.findUnique.mockResolvedValue({
        id: 'provider-1',
        isActive: true,
      });
      prisma.baseClient.providerSchedule.create.mockResolvedValue(mockSchedule);

      const result = await service.create({
        providerId: 'provider-1',
        dayOfWeek: 1,
        startTime: '08:00',
        endTime: '12:00',
      });

      expect(result).toEqual(mockSchedule);
      expect(prisma.baseClient.providerSchedule.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            providerId: 'provider-1',
            dayOfWeek: 1,
            startTime: '08:00',
            endTime: '12:00',
          }),
        }),
      );
    });

    it('should throw InfrastructureException when endTime <= startTime', async () => {
      await expect(
        service.create({
          providerId: 'provider-1',
          dayOfWeek: 1,
          startTime: '12:00',
          endTime: '10:00',
        }),
      ).rejects.toThrow(InfrastructureException);
    });

    it('should throw NotFoundException when provider not found', async () => {
      prisma.baseClient.provider.findUnique.mockResolvedValue(null);

      await expect(
        service.create({
          providerId: 'unknown',
          dayOfWeek: 1,
          startTime: '08:00',
          endTime: '12:00',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw InfrastructureException when provider is inactive', async () => {
      prisma.baseClient.provider.findUnique.mockResolvedValue({
        id: 'provider-1',
        isActive: false,
      });

      await expect(
        service.create({
          providerId: 'provider-1',
          dayOfWeek: 1,
          startTime: '08:00',
          endTime: '12:00',
        }),
      ).rejects.toThrow(InfrastructureException);
    });

    it('should handle overlap error from DB constraint', async () => {
      prisma.baseClient.provider.findUnique.mockResolvedValue({
        id: 'provider-1',
        isActive: true,
      });
      prisma.baseClient.providerSchedule.create.mockRejectedValue({
        code: 'P2009',
      });

      await expect(
        service.create({
          providerId: 'provider-1',
          dayOfWeek: 1,
          startTime: '08:00',
          endTime: '12:00',
        }),
      ).rejects.toThrow(InfrastructureException);
    });
  });

  describe('update', () => {
    it('should update a schedule block', async () => {
      prisma.baseClient.providerSchedule.findUnique.mockResolvedValue({
        id: 'sched-1',
      });
      prisma.baseClient.providerSchedule.update.mockResolvedValue({
        ...mockSchedule,
        startTime: '09:00',
      });

      const result = await service.update('sched-1', { startTime: '09:00' });

      expect(result.startTime).toBe('09:00');
    });

    it('should throw NotFoundException when schedule not found', async () => {
      prisma.baseClient.providerSchedule.findUnique.mockResolvedValue(null);

      await expect(
        service.update('unknown', { startTime: '09:00' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('delete', () => {
    it('should delete a schedule block and return affected appointments', async () => {
      prisma.baseClient.providerSchedule.findUnique
        .mockResolvedValueOnce({ id: 'sched-1' })
        .mockResolvedValueOnce({
          providerId: 'provider-1',
          dayOfWeek: 1,
        });
      prisma.baseClient.appointment.findMany.mockResolvedValue([
        {
          id: 'apt-1',
          startTime: new Date('2026-05-15T09:00:00Z'),
          status: 'scheduled',
        },
      ]);
      prisma.baseClient.providerSchedule.delete.mockResolvedValue({});

      const result = await service.delete('sched-1');

      expect(result.deleted).toBe(true);
      expect(result.affectedAppointments).toHaveLength(1);
    });

    it('should throw NotFoundException when schedule not found on delete', async () => {
      prisma.baseClient.providerSchedule.findUnique.mockResolvedValue(null);

      await expect(service.delete('unknown')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
