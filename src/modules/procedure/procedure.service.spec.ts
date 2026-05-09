import { Test } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { ProcedureService } from './procedure.service';
import { PrismaService } from '@modules/database';
import { AuditService } from '@modules/audit';
import { mockI18nContext } from '@common/test/i18n-mock';
import type { ProcedureQueryDto } from './dto/procedure-query.dto';

const mockProcedure = {
  id: 'procedure-1',
  adaCode: 'D0120',
  name: 'Periodic Oral Evaluation',
  category: 'diagnostic',
  durationMinutes: 30,
  defaultFee: 75.0,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('ProcedureService', () => {
  let service: ProcedureService;
  let prisma: any;
  let auditService: any;

  beforeEach(async () => {
    mockI18nContext();

    prisma = {
      baseClient: {
        procedure: {
          findMany: jest.fn().mockResolvedValue([]),
          count: jest.fn().mockResolvedValue(0),
          findFirst: jest.fn(),
          findUnique: jest.fn(),
          create: jest.fn(),
          update: jest.fn(),
        },
        patientProcedure: {
          count: jest.fn().mockResolvedValue(0),
        },
      },
    };

    auditService = { emit: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        ProcedureService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();

    service = module.get(ProcedureService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('findAll', () => {
    it('should return paginated results with default search/filter', async () => {
      prisma.baseClient.procedure.findMany.mockResolvedValue([mockProcedure]);
      prisma.baseClient.procedure.count.mockResolvedValue(1);

      const query: ProcedureQueryDto = { page: 1, limit: 10 };
      const result = await service.findAll(query);

      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
      expect(prisma.baseClient.procedure.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.not.objectContaining(['isActive', 'category', 'OR']),
        }),
      );
    });

    it('should filter by isActive=false when query parameter set', async () => {
      prisma.baseClient.procedure.findMany.mockResolvedValue([]);
      prisma.baseClient.procedure.count.mockResolvedValue(0);

      const query: ProcedureQueryDto = { isActive: false, page: 1, limit: 10 };
      await service.findAll(query);

      expect(prisma.baseClient.procedure.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isActive: false }),
        }),
      );
    });

    it('should filter by category when query parameter set', async () => {
      prisma.baseClient.procedure.findMany.mockResolvedValue([]);
      prisma.baseClient.procedure.count.mockResolvedValue(0);

      const query: ProcedureQueryDto = {
        category: 'diagnostic',
        page: 1,
        limit: 10,
      };
      await service.findAll(query);

      expect(prisma.baseClient.procedure.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ category: 'diagnostic' }),
        }),
      );
    });

    it('should search by name and adaCode when search parameter set', async () => {
      prisma.baseClient.procedure.findMany.mockResolvedValue([]);
      prisma.baseClient.procedure.count.mockResolvedValue(0);

      const query: ProcedureQueryDto = { search: 'D0120', page: 1, limit: 10 };
      await service.findAll(query);

      expect(prisma.baseClient.procedure.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [
              { name: { contains: 'D0120', mode: 'insensitive' } },
              { adaCode: { contains: 'D0120', mode: 'insensitive' } },
            ],
          }),
        }),
      );
    });
  });

  describe('findById', () => {
    it('should return procedure by id', async () => {
      prisma.baseClient.procedure.findUnique.mockResolvedValue(mockProcedure);

      const result = await service.findById('procedure-1');

      expect(result).toMatchObject({
        id: 'procedure-1',
        adaCode: 'D0120',
        name: 'Periodic Oral Evaluation',
        category: 'diagnostic',
        isActive: true,
      });
    });

    it('should throw NotFoundException when procedure not found', async () => {
      prisma.baseClient.procedure.findUnique.mockResolvedValue(null);

      await expect(service.findById('unknown-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    it('should create a procedure with all fields', async () => {
      const createDto = {
        adaCode: 'D0120',
        name: 'Periodic Oral Evaluation',
        category: 'diagnostic',
        durationMinutes: 30,
        defaultFee: 75.0,
      };
      prisma.baseClient.procedure.create.mockResolvedValue(mockProcedure);

      const result = await service.create(createDto);

      expect(result).toBeDefined();
      expect(prisma.baseClient.procedure.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            adaCode: 'D0120',
            name: 'Periodic Oral Evaluation',
            category: 'diagnostic',
            durationMinutes: 30,
            defaultFee: 75.0,
          }),
        }),
      );
    });

    it('should return created procedure with PROCEDURE_DETAIL_SELECT', async () => {
      prisma.baseClient.procedure.create.mockResolvedValue(mockProcedure);

      const result = await service.create({
        adaCode: 'D0120',
        name: 'Periodic Oral Evaluation',
        category: 'diagnostic',
        durationMinutes: 30,
        defaultFee: 75.0,
      });

      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('adaCode');
      expect(result).toHaveProperty('name');
      expect(result).toHaveProperty('category');
      expect(result).toHaveProperty('durationMinutes');
      expect(result).toHaveProperty('defaultFee');
      expect(result).toHaveProperty('isActive');
      expect(result).toHaveProperty('createdAt');
      expect(result).toHaveProperty('updatedAt');
    });
  });

  describe('update', () => {
    it('should update a procedure successfully (name, category, duration, fee)', async () => {
      prisma.baseClient.procedure.findUnique
        .mockResolvedValueOnce({
          id: 'procedure-1',
          adaCode: 'D0120',
          isActive: true,
        })
        .mockResolvedValueOnce({
          id: 'procedure-1',
          adaCode: 'D0120',
          isActive: true,
        });
      prisma.baseClient.procedure.update.mockResolvedValue({
        ...mockProcedure,
        name: 'Updated Procedure',
        category: 'restorative',
        durationMinutes: 60,
        defaultFee: 150.0,
      });

      const result = await service.update('procedure-1', {
        name: 'Updated Procedure',
        category: 'restorative',
        durationMinutes: 60,
        defaultFee: 150.0,
      });

      expect(result.name).toBe('Updated Procedure');
      expect(result.category).toBe('restorative');
      expect(result.durationMinutes).toBe(60);
      expect(result.defaultFee).toBe(150.0);
      expect(prisma.baseClient.procedure.update).toHaveBeenCalled();
    });

    it('should block adaCode change when AppointmentProcedure references exist', async () => {
      prisma.baseClient.procedure.findUnique.mockResolvedValue({
        id: 'procedure-1',
        adaCode: 'D0120',
        isActive: true,
      });
      prisma.baseClient.patientProcedure.count.mockResolvedValue(5);

      await expect(
        service.update('procedure-1', { adaCode: 'D9999' }),
      ).rejects.toThrow(ConflictException);

      await expect(
        service.update('procedure-1', { adaCode: 'D9999' }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          errorCode: 'PROCEDURE_ADA_CODE_LOCKED',
          referenceCount: 5,
        }),
      });
    });

    it('should allow adaCode change when no AppointmentProcedure references exist', async () => {
      prisma.baseClient.procedure.findUnique
        .mockResolvedValueOnce({
          id: 'procedure-1',
          adaCode: 'D0120',
          isActive: true,
        })
        .mockResolvedValueOnce({
          id: 'procedure-1',
          adaCode: 'D9999',
          isActive: true,
        });
      prisma.baseClient.patientProcedure.count.mockResolvedValue(0);
      prisma.baseClient.procedure.update.mockResolvedValue({
        ...mockProcedure,
        adaCode: 'D9999',
      });

      const result = await service.update('procedure-1', { adaCode: 'D9999' });

      expect(result.adaCode).toBe('D9999');
      expect(prisma.baseClient.procedure.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ adaCode: 'D9999' }),
        }),
      );
    });

    it('should emit PROCEDURE_DISABLED audit event when toggling isActive true→false', async () => {
      prisma.baseClient.procedure.findUnique
        .mockResolvedValueOnce({
          id: 'procedure-1',
          adaCode: 'D0120',
          isActive: true,
        })
        .mockResolvedValueOnce({
          id: 'procedure-1',
          adaCode: 'D0120',
          isActive: false,
        });
      prisma.baseClient.procedure.update.mockResolvedValue({
        ...mockProcedure,
        isActive: false,
      });

      await service.update('procedure-1', { isActive: false });

      expect(auditService.emit).toHaveBeenCalledWith({
        code: 'PROCEDURE_DISABLED',
        resource: 'procedure',
        resourceId: 'procedure-1',
        before: { isActive: true },
        after: { isActive: false },
      });
    });

    it('should emit PROCEDURE_ENABLED audit event when toggling isActive false→true', async () => {
      prisma.baseClient.procedure.findUnique
        .mockResolvedValueOnce({
          id: 'procedure-1',
          adaCode: 'D0120',
          isActive: false,
        })
        .mockResolvedValueOnce({
          id: 'procedure-1',
          adaCode: 'D0120',
          isActive: true,
        });
      prisma.baseClient.procedure.update.mockResolvedValue({
        ...mockProcedure,
        isActive: true,
      });

      await service.update('procedure-1', { isActive: true });

      expect(auditService.emit).toHaveBeenCalledWith({
        code: 'PROCEDURE_ENABLED',
        resource: 'procedure',
        resourceId: 'procedure-1',
        before: { isActive: false },
        after: { isActive: true },
      });
    });

    it('should throw NotFoundException when procedure not found', async () => {
      prisma.baseClient.procedure.findUnique.mockResolvedValue(null);

      await expect(
        service.update('unknown-id', { name: 'New Name' }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
