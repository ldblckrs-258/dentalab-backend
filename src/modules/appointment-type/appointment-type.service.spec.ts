import { Test } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { AppointmentTypeService } from './appointment-type.service';
import { PrismaService } from '@modules/database';
import { CacheService } from '@modules/redis';
import { mockI18nContext } from '@common/test/i18n-mock';
import type { AppointmentTypeQueryDto } from './dto/appointment-type-query.dto';

const mockType = {
  id: 'type-1',
  name: 'Check-up',
  durationMinutes: 30,
  color: '#3B82F6',
  textColor: '#FFFFFF',
  isActive: true,
  createdBy: 'user-1',
  updatedBy: 'user-1',
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('AppointmentTypeService', () => {
  let service: AppointmentTypeService;
  let prisma: any;
  let cacheService: any;

  beforeEach(async () => {
    mockI18nContext();

    prisma = {
      baseClient: {
        appointmentType: {
          findMany: jest.fn().mockResolvedValue([]),
          count: jest.fn().mockResolvedValue(0),
          findFirst: jest.fn(),
          findUnique: jest.fn(),
          create: jest.fn(),
          update: jest.fn(),
        },
        appointment: {
          count: jest.fn().mockResolvedValue(0),
        },
      },
    };

    cacheService = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      invalidatePattern: jest.fn().mockResolvedValue(0),
    };

    const module = await Test.createTestingModule({
      providers: [
        AppointmentTypeService,
        { provide: PrismaService, useValue: prisma },
        { provide: CacheService, useValue: cacheService },
      ],
    }).compile();

    service = module.get(AppointmentTypeService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('findAll', () => {
    it('should return paginated results', async () => {
      prisma.baseClient.appointmentType.findMany.mockResolvedValue([mockType]);
      prisma.baseClient.appointmentType.count.mockResolvedValue(1);

      const query: AppointmentTypeQueryDto = { page: 1, limit: 10 };
      const result = await service.findAll(query);

      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
      expect(cacheService.set).toHaveBeenCalledWith(
        'appointment-types',
        expect.stringMatching(/^list:/),
        result,
        300,
      );
    });

    it('should return cached paginated results when available', async () => {
      const cached = {
        data: [mockType],
        meta: {
          total: 1,
          page: 1,
          limit: 10,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      };
      cacheService.get.mockResolvedValue(cached);

      const result = await service.findAll({ page: 1, limit: 10 });

      expect(result).toBe(cached);
      expect(prisma.baseClient.appointmentType.findMany).not.toHaveBeenCalled();
    });

    it('should filter by isActive', async () => {
      prisma.baseClient.appointmentType.findMany.mockResolvedValue([]);
      prisma.baseClient.appointmentType.count.mockResolvedValue(0);

      const query: AppointmentTypeQueryDto = {
        isActive: false,
        page: 1,
        limit: 10,
      };
      await service.findAll(query);

      expect(prisma.baseClient.appointmentType.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isActive: false }),
        }),
      );
    });

    it('should search by name', async () => {
      prisma.baseClient.appointmentType.findMany.mockResolvedValue([]);
      prisma.baseClient.appointmentType.count.mockResolvedValue(0);

      const query: AppointmentTypeQueryDto = {
        search: 'Check',
        page: 1,
        limit: 10,
      };
      await service.findAll(query);

      expect(prisma.baseClient.appointmentType.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [{ name: { contains: 'Check', mode: 'insensitive' } }],
          }),
        }),
      );
    });
  });

  describe('findById', () => {
    it('should return appointment type by id', async () => {
      prisma.baseClient.appointmentType.findUnique.mockResolvedValue(mockType);

      const result = await service.findById('type-1');

      expect(result).toMatchObject({
        id: 'type-1',
        name: 'Check-up',
        isActive: true,
      });
      expect(cacheService.set).toHaveBeenCalledWith(
        'appointment-types',
        'detail:type-1',
        mockType,
        300,
      );
    });

    it('should return cached appointment type by id when available', async () => {
      cacheService.get.mockResolvedValue(mockType);

      const result = await service.findById('type-1');

      expect(result).toBe(mockType);
      expect(
        prisma.baseClient.appointmentType.findUnique,
      ).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when not found', async () => {
      prisma.baseClient.appointmentType.findUnique.mockResolvedValue(null);

      await expect(service.findById('unknown-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    it('should create with all fields including userId', async () => {
      prisma.baseClient.appointmentType.findFirst.mockResolvedValue(null);
      prisma.baseClient.appointmentType.create.mockResolvedValue(mockType);

      const dto = {
        name: 'Check-up',
        durationMinutes: 30,
        color: '#3B82F6',
        textColor: '#FFFFFF',
      };
      const result = await service.create(dto, 'user-1');

      expect(result).toBeDefined();
      expect(prisma.baseClient.appointmentType.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'Check-up',
            durationMinutes: 30,
            color: '#3B82F6',
            textColor: '#FFFFFF',
            createdBy: 'user-1',
            updatedBy: 'user-1',
          }),
        }),
      );
      expect(cacheService.invalidatePattern).toHaveBeenCalledWith(
        'dentalab:appointment-types:*',
      );
    });

    it('should reject duplicate active name', async () => {
      prisma.baseClient.appointmentType.findFirst.mockResolvedValue({
        id: 'existing',
      });

      await expect(
        service.create({ name: 'Check-up', durationMinutes: 30 }, 'user-1'),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('update', () => {
    it('should update name and duration', async () => {
      prisma.baseClient.appointmentType.findUnique.mockResolvedValue({
        id: 'type-1',
        name: 'Check-up',
        isActive: true,
      });
      prisma.baseClient.appointmentType.findFirst.mockResolvedValue(null);
      prisma.baseClient.appointmentType.update.mockResolvedValue({
        ...mockType,
        name: 'New Check-up',
        durationMinutes: 45,
      });

      const result = await service.update(
        'type-1',
        { name: 'New Check-up', durationMinutes: 45 },
        'user-1',
      );

      expect(result.name).toBe('New Check-up');
      expect(result.durationMinutes).toBe(45);
      expect(cacheService.invalidatePattern).toHaveBeenCalledWith(
        'dentalab:appointment-types:*',
      );
    });

    it('should set updatedBy when updating', async () => {
      prisma.baseClient.appointmentType.findUnique.mockResolvedValue({
        id: 'type-1',
        name: 'Check-up',
        isActive: true,
      });
      prisma.baseClient.appointmentType.update.mockResolvedValue(mockType);

      await service.update('type-1', { name: 'Updated' }, 'user-2');

      expect(prisma.baseClient.appointmentType.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            updatedBy: 'user-2',
          }),
        }),
      );
    });
  });

  describe('deactivate', () => {
    it('should set isActive to false', async () => {
      prisma.baseClient.appointmentType.findUnique.mockResolvedValue({
        id: 'type-1',
        name: 'Check-up',
        isActive: true,
      });
      prisma.baseClient.appointmentType.update.mockResolvedValue({
        ...mockType,
        isActive: false,
      });

      const result = await service.deactivate('type-1', 'user-1');

      expect(result.isActive).toBe(false);
      expect(prisma.baseClient.appointmentType.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { isActive: false, updatedBy: 'user-1' },
        }),
      );
      expect(cacheService.invalidatePattern).toHaveBeenCalledWith(
        'dentalab:appointment-types:*',
      );
    });

    it('should throw when already inactive', async () => {
      prisma.baseClient.appointmentType.findUnique.mockResolvedValue({
        id: 'type-1',
        name: 'Check-up',
        isActive: false,
      });

      await expect(service.deactivate('type-1', 'user-1')).rejects.toThrow(
        ConflictException,
      );
    });
  });
});
