import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { OperatoryService } from './operatory.service';
import { PrismaService } from '@modules/database';
import { mockI18nContext } from '@common/test/i18n-mock';
import type { OperatoryQueryDto } from './dto/operatory-query.dto';

const mockOperatory = {
  id: 'op-1',
  name: 'Room 1',
  code: 'OP-1',
  color: '#3B82F6',
  isActive: true,
  displayOrder: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('OperatoryService', () => {
  let service: OperatoryService;
  let prisma: any;

  beforeEach(async () => {
    mockI18nContext();

    prisma = {
      baseClient: {
        operatory: {
          findMany: jest.fn().mockResolvedValue([]),
          count: jest.fn().mockResolvedValue(0),
          aggregate: jest
            .fn()
            .mockResolvedValue({ _max: { displayOrder: null } }),
          findFirst: jest.fn(),
          findUnique: jest.fn(),
          create: jest.fn(),
          update: jest.fn(),
        },
        appointment: {
          count: jest.fn().mockResolvedValue(0),
          findMany: jest.fn().mockResolvedValue([]),
        },
        $executeRaw: jest.fn().mockResolvedValue(0),
        $transaction: jest
          .fn()
          .mockImplementation((arg) =>
            typeof arg === 'function'
              ? arg(prisma.baseClient)
              : Promise.resolve([]),
          ),
      },
    };

    const module = await Test.createTestingModule({
      providers: [
        OperatoryService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(OperatoryService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('findAll', () => {
    it('should return paginated results', async () => {
      prisma.baseClient.operatory.findMany.mockResolvedValue([mockOperatory]);
      prisma.baseClient.operatory.count.mockResolvedValue(1);

      const query: OperatoryQueryDto = { page: 1, limit: 10 };
      const result = await service.findAll(query);

      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
    });

    it('should filter by isActive', async () => {
      const query: OperatoryQueryDto = { isActive: false, page: 1, limit: 10 };
      await service.findAll(query);

      expect(prisma.baseClient.operatory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isActive: false }),
        }),
      );
    });
  });

  describe('create', () => {
    it('should assign next displayOrder and persist fields', async () => {
      prisma.baseClient.operatory.findFirst.mockResolvedValue(null);
      prisma.baseClient.operatory.aggregate.mockResolvedValue({
        _max: { displayOrder: 4 },
      });
      prisma.baseClient.operatory.create.mockResolvedValue(mockOperatory);

      await service.create({ name: 'Room 6', code: 'OP-6', color: '#10B981' });

      expect(prisma.baseClient.operatory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'Room 6',
            code: 'OP-6',
            color: '#10B981',
            displayOrder: 5,
          }),
        }),
      );
    });

    it('should start displayOrder at 0 when no operatories exist', async () => {
      prisma.baseClient.operatory.findFirst.mockResolvedValue(null);
      prisma.baseClient.operatory.aggregate.mockResolvedValue({
        _max: { displayOrder: null },
      });
      prisma.baseClient.operatory.create.mockResolvedValue(mockOperatory);

      await service.create({ name: 'Room 1', code: 'OP-1', color: '#3B82F6' });

      expect(prisma.baseClient.operatory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ displayOrder: 0 }),
        }),
      );
    });

    it('should reject duplicate code', async () => {
      prisma.baseClient.operatory.findFirst.mockResolvedValue({ id: 'dup' });

      await expect(
        service.create({ name: 'Room 1', code: 'OP-1', color: '#3B82F6' }),
      ).rejects.toThrow(ConflictException);
    });

    it('serializes displayOrder allocation with an advisory lock in a transaction', async () => {
      prisma.baseClient.operatory.findFirst.mockResolvedValue(null);
      prisma.baseClient.operatory.aggregate.mockResolvedValue({
        _max: { displayOrder: 2 },
      });
      prisma.baseClient.operatory.create.mockResolvedValue(mockOperatory);

      await service.create({ name: 'Room X', code: 'OP-X', color: '#FFFFFF' });

      expect(prisma.baseClient.$transaction).toHaveBeenCalled();
      expect(prisma.baseClient.$executeRaw).toHaveBeenCalled();
      expect(prisma.baseClient.operatory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ displayOrder: 3 }),
        }),
      );
    });
  });

  describe('deactivate', () => {
    it('should set isActive to false when no future appointments', async () => {
      prisma.baseClient.operatory.findUnique.mockResolvedValue({
        id: 'op-1',
        code: 'OP-1',
        isActive: true,
      });
      prisma.baseClient.appointment.count.mockResolvedValue(0);
      prisma.baseClient.operatory.update.mockResolvedValue({
        ...mockOperatory,
        isActive: false,
      });

      const result = await service.deactivate('op-1');

      expect(result.isActive).toBe(false);
      expect(prisma.baseClient.operatory.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { isActive: false } }),
      );
    });

    it('should block deactivation when future appointments exist', async () => {
      prisma.baseClient.operatory.findUnique.mockResolvedValue({
        id: 'op-1',
        code: 'OP-1',
        isActive: true,
      });
      prisma.baseClient.appointment.count.mockResolvedValue(3);

      await expect(service.deactivate('op-1')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.baseClient.operatory.update).not.toHaveBeenCalled();
    });

    it('should throw when already inactive', async () => {
      prisma.baseClient.operatory.findUnique.mockResolvedValue({
        id: 'op-1',
        code: 'OP-1',
        isActive: false,
      });

      await expect(service.deactivate('op-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('should throw NotFound when operatory missing', async () => {
      prisma.baseClient.operatory.findUnique.mockResolvedValue(null);

      await expect(service.deactivate('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('reorder', () => {
    it('should rewrite displayOrder to match input order', async () => {
      prisma.baseClient.operatory.findMany
        .mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
        .mockResolvedValueOnce([]);

      await service.reorder({ orderedIds: ['c', 'a', 'b'] });

      expect(prisma.baseClient.$transaction).toHaveBeenCalled();
      expect(prisma.baseClient.operatory.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'c' },
          data: { displayOrder: 0 },
        }),
      );
    });

    it('should reject a partial reorder list', async () => {
      prisma.baseClient.operatory.findMany.mockResolvedValue([
        { id: 'a' },
        { id: 'b' },
        { id: 'c' },
      ]);

      await expect(service.reorder({ orderedIds: ['a', 'b'] })).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.baseClient.$transaction).not.toHaveBeenCalled();
    });

    it('should reject unknown ids', async () => {
      prisma.baseClient.operatory.findMany.mockResolvedValue([
        { id: 'a' },
        { id: 'b' },
      ]);

      await expect(
        service.reorder({ orderedIds: ['a', 'zzz'] }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getBusyOperatoryIds', () => {
    it('returns distinct occupied operatory ids; filters match the gist predicate', async () => {
      prisma.baseClient.appointment.findMany.mockResolvedValue([
        { operatoryId: 'op-1' },
        { operatoryId: 'op-2' },
      ]);

      const start = new Date('2026-06-07T02:00:00.000Z');
      const end = new Date('2026-06-07T02:30:00.000Z');
      const busy = await service.getBusyOperatoryIds(start, end);

      expect(busy).toEqual(['op-1', 'op-2']);
      const args = prisma.baseClient.appointment.findMany.mock.calls[0][0];
      expect(args.where.status).toEqual({ notIn: ['cancelled', 'no_show'] });
      expect(args.where.operatoryId).toEqual({ not: null });
      expect(args.where.startTime).toEqual({ lt: end });
      expect(args.where.endTime).toEqual({ gt: start });
      expect(args.distinct).toEqual(['operatoryId']);
    });

    it('passes excludeAppointmentId as an id-not filter', async () => {
      prisma.baseClient.appointment.findMany.mockResolvedValue([]);

      await service.getBusyOperatoryIds(
        new Date('2026-06-07T02:00:00.000Z'),
        new Date('2026-06-07T02:30:00.000Z'),
        'appt-self',
      );

      const args = prisma.baseClient.appointment.findMany.mock.calls[0][0];
      expect(args.where.id).toEqual({ not: 'appt-self' });
    });
  });
});
