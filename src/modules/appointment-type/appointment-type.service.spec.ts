import { Test } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { AppointmentTypeService } from './appointment-type.service';
import { PrismaService } from '@modules/database';
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

    const module = await Test.createTestingModule({
      providers: [
        AppointmentTypeService,
        { provide: PrismaService, useValue: prisma },
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
