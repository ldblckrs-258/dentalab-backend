import { Test } from '@nestjs/testing';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { TreatmentPlanService } from './treatment-plan.service';
import { PrismaService } from '@modules/database';
import { PermissionResolverService } from '@modules/rbac/services/permission-resolver.service';
import { AuditService } from '@modules/audit';
import { RequestContextService } from '@modules/common/context/request-context';
import { mockI18nContext } from '@common/test/i18n-mock';

const mockProvider = { id: 'provider-1', userId: 'user-1' };
const mockPlan = {
  id: 'plan-1',
  patientId: 'patient-1',
  providerId: 'provider-1',
  name: 'Test Plan',
  status: 'draft',
  startDate: null,
  endDate: null,
  estimatedTotalCost: null,
  notes: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function setupMocks() {
  jest.spyOn(RequestContextService, 'getUserId').mockReturnValue('user-1');
}

describe('TreatmentPlanService', () => {
  let service: TreatmentPlanService;
  let prisma: any;
  let permissionResolver: any;
  let auditService: any;

  beforeEach(async () => {
    mockI18nContext();
    setupMocks();

    prisma = {
      transaction: jest
        .fn()
        .mockImplementation((fn: (tx: unknown) => unknown) =>
          fn(prisma.baseClient),
        ),
      baseClient: {
        treatmentPlan: {
          findMany: jest.fn().mockResolvedValue([]),
          count: jest.fn().mockResolvedValue(0),
          findUnique: jest.fn(),
          create: jest.fn(),
          update: jest.fn(),
        },
        provider: {
          findUnique: jest.fn().mockResolvedValue(mockProvider),
        },
        patient: {
          findFirst: jest.fn().mockResolvedValue({ id: 'patient-1' }),
        },
        appointment: {
          count: jest.fn().mockResolvedValue(0),
          findMany: jest.fn().mockResolvedValue([]),
        },
      },
    };

    permissionResolver = {
      resolvePermissions: jest
        .fn()
        .mockResolvedValue(['treatment_plans:read:full']),
    };

    auditService = { emit: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        TreatmentPlanService,
        { provide: PrismaService, useValue: prisma },
        { provide: PermissionResolverService, useValue: permissionResolver },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();

    service = module.get(TreatmentPlanService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('findAll', () => {
    it('should return paginated results with doctor scope', async () => {
      prisma.baseClient.treatmentPlan.findMany.mockResolvedValue([
        {
          ...mockPlan,
          patient: {
            id: 'p1',
            firstName: 'John',
            lastName: 'Doe',
            deletedAt: null,
          },
          provider: { id: 'pv1', user: { fullName: 'Dr. Smith' } },
        },
      ]);
      prisma.baseClient.treatmentPlan.count.mockResolvedValue(1);

      const result = await service.findAll({ page: 1, limit: 10 });
      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
    });

    it('should throw ForbiddenException when scope=all without full read', async () => {
      permissionResolver.resolvePermissions.mockResolvedValue([
        'treatment_plans:read:metadata',
      ]);
      await expect(service.findAll({ scope: 'all' })).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('findById', () => {
    it('should return detail projection for full read permission', async () => {
      prisma.baseClient.treatmentPlan.findUnique.mockResolvedValue({
        ...mockPlan,
        notes: 'Some notes',
        patient: {
          id: 'p1',
          firstName: 'John',
          lastName: 'Doe',
          deletedAt: null,
        },
        provider: { id: 'pv1', user: { fullName: 'Dr. Smith' } },
      });

      const result = await service.findById('plan-1');
      expect(result).toHaveProperty('notes');
      expect(result).toHaveProperty('estimatedTotalCost');
      expect(result).toHaveProperty('actualTotalCost', 0);
      expect(result).toHaveProperty('variance');
    });

    it('should return metadata projection for metadata-only permission', async () => {
      permissionResolver.resolvePermissions.mockResolvedValue([
        'treatment_plans:read:metadata',
      ]);
      prisma.baseClient.treatmentPlan.findUnique.mockResolvedValue({
        id: 'plan-1',
        patientId: 'patient-1',
        providerId: 'provider-1',
        name: 'Test Plan',
        status: 'draft',
        startDate: null,
        endDate: null,
        updatedAt: new Date(),
        patient: {
          id: 'p1',
          firstName: 'John',
          lastName: 'Doe',
          deletedAt: null,
        },
        provider: { id: 'pv1', user: { fullName: 'Dr. Smith' } },
      });

      const result = await service.findById('plan-1');
      expect(result).not.toHaveProperty('notes');
      expect(result).not.toHaveProperty('estimatedTotalCost');
    });

    it('should show deleted patient placeholder', async () => {
      prisma.baseClient.treatmentPlan.findUnique.mockResolvedValue({
        ...mockPlan,
        patient: {
          id: 'p1',
          firstName: 'John',
          lastName: 'Doe',
          deletedAt: new Date(),
        },
        provider: { id: 'pv1', user: { fullName: 'Dr. Smith' } },
      });

      const result = await service.findById('plan-1');
      expect(result.patientName).toBe('patient.deletedPlaceholder');
    });

    it('should throw NotFoundException if not found', async () => {
      prisma.baseClient.treatmentPlan.findUnique.mockResolvedValue(null);
      await expect(service.findById('unknown')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    it('should create a treatment plan with draft status', async () => {
      prisma.baseClient.treatmentPlan.create.mockResolvedValue(mockPlan);

      const result = await service.create({
        patientId: 'patient-1',
        name: 'Test Plan',
      });

      expect(result.status).toBe('draft');
      expect(prisma.baseClient.treatmentPlan.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            providerId: 'provider-1',
            status: 'draft',
          }),
        }),
      );
    });

    it('should throw ForbiddenException if user is not a provider', async () => {
      prisma.baseClient.provider.findUnique.mockResolvedValue(null);
      await expect(
        service.create({ patientId: 'patient-1', name: 'Test' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException if patient does not exist', async () => {
      prisma.baseClient.patient.findFirst.mockResolvedValue(null);
      await expect(
        service.create({ patientId: 'patient-1', name: 'Test' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('should update plan when status is draft', async () => {
      prisma.baseClient.treatmentPlan.findUnique
        .mockResolvedValueOnce({
          id: 'plan-1',
          providerId: 'provider-1',
          status: 'draft',
        })
        .mockResolvedValueOnce({ providerId: 'provider-1' });
      prisma.baseClient.treatmentPlan.update.mockResolvedValue(mockPlan);

      const result = await service.update('plan-1', { name: 'Updated' });
      expect(result).toBeDefined();
    });

    it('should allow notes+endDate update when status is accepted', async () => {
      prisma.baseClient.treatmentPlan.findUnique
        .mockResolvedValueOnce({
          id: 'plan-1',
          providerId: 'provider-1',
          status: 'accepted',
        })
        .mockResolvedValueOnce({ providerId: 'provider-1' });
      prisma.baseClient.treatmentPlan.update.mockResolvedValue(mockPlan);

      await service.update('plan-1', {
        notes: 'Updated notes',
        endDate: '2026-12-31',
      });
      expect(prisma.baseClient.treatmentPlan.update).toHaveBeenCalled();
    });

    it('should block name change when status is accepted (edit lock)', async () => {
      prisma.baseClient.treatmentPlan.findUnique
        .mockResolvedValueOnce({
          id: 'plan-1',
          providerId: 'provider-1',
          status: 'accepted',
        })
        .mockResolvedValueOnce({ providerId: 'provider-1' });

      await expect(
        service.update('plan-1', { name: 'New Name' }),
      ).rejects.toThrow(ConflictException);
    });

    it('should block update by doctor who does not own the plan', async () => {
      prisma.baseClient.treatmentPlan.findUnique
        .mockResolvedValueOnce({
          id: 'plan-1',
          providerId: 'provider-1',
          status: 'draft',
        })
        .mockResolvedValueOnce({ providerId: 'other-provider' });

      await expect(
        service.update('plan-1', { name: 'New Name' }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('transition', () => {
    beforeEach(() => {
      prisma.baseClient.treatmentPlan.update.mockResolvedValue(mockPlan);
    });

    it('should allow draft → proposed', async () => {
      prisma.baseClient.treatmentPlan.findUnique
        .mockResolvedValueOnce({
          id: 'plan-1',
          providerId: 'provider-1',
          status: 'draft',
          notes: 'has notes',
        })
        .mockResolvedValueOnce({ providerId: 'provider-1' });
      await expect(
        service.transition('plan-1', { to: 'proposed' }),
      ).resolves.toBeDefined();
    });

    it('should allow proposed → accepted when notes are non-empty', async () => {
      prisma.baseClient.treatmentPlan.findUnique
        .mockResolvedValueOnce({
          id: 'plan-1',
          providerId: 'provider-1',
          status: 'proposed',
          notes: 'Patient consented',
        })
        .mockResolvedValueOnce({ providerId: 'provider-1' });
      await expect(
        service.transition('plan-1', { to: 'accepted' }),
      ).resolves.toBeDefined();
    });

    it('should allow accepted → in_progress when non-cancelled appointment exists', async () => {
      prisma.baseClient.treatmentPlan.findUnique
        .mockResolvedValueOnce({
          id: 'plan-1',
          providerId: 'provider-1',
          status: 'accepted',
          notes: 'ok',
        })
        .mockResolvedValueOnce({ providerId: 'provider-1' });
      prisma.baseClient.appointment.count.mockResolvedValue(1);
      await expect(
        service.transition('plan-1', { to: 'in_progress' }),
      ).resolves.toBeDefined();
    });

    it('should allow in_progress → completed when all appointments are completed/cancelled', async () => {
      prisma.baseClient.treatmentPlan.findUnique
        .mockResolvedValueOnce({
          id: 'plan-1',
          providerId: 'provider-1',
          status: 'in_progress',
          notes: 'ok',
        })
        .mockResolvedValueOnce({ providerId: 'provider-1' });
      prisma.baseClient.appointment.count.mockResolvedValue(0);
      await expect(
        service.transition('plan-1', { to: 'completed' }),
      ).resolves.toBeDefined();
    });

    it('should allow draft → proposed → accepted → in_progress → completed (full walk)', async () => {
      prisma.baseClient.treatmentPlan.findUnique
        .mockResolvedValueOnce({
          id: 'plan-1',
          providerId: 'provider-1',
          status: 'draft',
          notes: 'consent recorded',
        })
        .mockResolvedValueOnce({ providerId: 'provider-1' });
      await service.transition('plan-1', { to: 'proposed' });

      prisma.baseClient.treatmentPlan.findUnique
        .mockResolvedValueOnce({
          id: 'plan-1',
          providerId: 'provider-1',
          status: 'proposed',
          notes: 'consent recorded',
        })
        .mockResolvedValueOnce({ providerId: 'provider-1' });
      await service.transition('plan-1', { to: 'accepted' });

      prisma.baseClient.appointment.count.mockResolvedValue(1);
      prisma.baseClient.treatmentPlan.findUnique
        .mockResolvedValueOnce({
          id: 'plan-1',
          providerId: 'provider-1',
          status: 'accepted',
          notes: 'consent recorded',
        })
        .mockResolvedValueOnce({ providerId: 'provider-1' });
      await service.transition('plan-1', { to: 'in_progress' });

      prisma.baseClient.appointment.count.mockResolvedValue(0);
      prisma.baseClient.treatmentPlan.findUnique
        .mockResolvedValueOnce({
          id: 'plan-1',
          providerId: 'provider-1',
          status: 'in_progress',
          notes: 'consent recorded',
        })
        .mockResolvedValueOnce({ providerId: 'provider-1' });
      await service.transition('plan-1', { to: 'completed' });
      // No error thrown
    });

    it('should reject accepted → completed directly (invalid skip)', async () => {
      prisma.baseClient.treatmentPlan.findUnique
        .mockResolvedValueOnce({
          id: 'plan-1',
          providerId: 'provider-1',
          status: 'accepted',
          notes: 'ok',
        })
        .mockResolvedValueOnce({ providerId: 'provider-1' });
      await expect(
        service.transition('plan-1', { to: 'completed' }),
      ).rejects.toThrow(ConflictException);
    });

    it('should reject proposed → accepted when notes are empty', async () => {
      prisma.baseClient.treatmentPlan.findUnique
        .mockResolvedValueOnce({
          id: 'plan-1',
          providerId: 'provider-1',
          status: 'proposed',
          notes: null,
        })
        .mockResolvedValueOnce({ providerId: 'provider-1' });
      await expect(
        service.transition('plan-1', { to: 'accepted' }),
      ).rejects.toThrow(ConflictException);
    });

    it('should reject accepted → in_progress when no appointments exist', async () => {
      prisma.baseClient.treatmentPlan.findUnique
        .mockResolvedValueOnce({
          id: 'plan-1',
          providerId: 'provider-1',
          status: 'accepted',
          notes: 'ok',
        })
        .mockResolvedValueOnce({ providerId: 'provider-1' });
      prisma.baseClient.appointment.count.mockResolvedValue(0);
      await expect(
        service.transition('plan-1', { to: 'in_progress' }),
      ).rejects.toThrow(ConflictException);
    });

    it('should reject in_progress → completed when pending appointments exist', async () => {
      prisma.baseClient.treatmentPlan.findUnique
        .mockResolvedValueOnce({
          id: 'plan-1',
          providerId: 'provider-1',
          status: 'in_progress',
          notes: 'ok',
        })
        .mockResolvedValueOnce({ providerId: 'provider-1' });
      prisma.baseClient.appointment.count.mockResolvedValue(3);
      await expect(
        service.transition('plan-1', { to: 'completed' }),
      ).rejects.toThrow(ConflictException);
    });

    it('should reject transition from completed (terminal)', async () => {
      prisma.baseClient.treatmentPlan.findUnique
        .mockResolvedValueOnce({
          id: 'plan-1',
          providerId: 'provider-1',
          status: 'completed',
          notes: null,
        })
        .mockResolvedValueOnce({ providerId: 'provider-1' });
      await expect(
        service.transition('plan-1', { to: 'draft' }),
      ).rejects.toThrow(ConflictException);
    });

    it('should reject transition from cancelled (terminal)', async () => {
      prisma.baseClient.treatmentPlan.findUnique
        .mockResolvedValueOnce({
          id: 'plan-1',
          providerId: 'provider-1',
          status: 'cancelled',
          notes: null,
        })
        .mockResolvedValueOnce({ providerId: 'provider-1' });
      await expect(
        service.transition('plan-1', { to: 'draft' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('cancel', () => {
    it('should transition to cancelled status', async () => {
      prisma.baseClient.treatmentPlan.findUnique
        .mockResolvedValueOnce({
          id: 'plan-1',
          providerId: 'provider-1',
          status: 'draft',
          notes: null,
        })
        .mockResolvedValueOnce({ providerId: 'provider-1' });
      prisma.baseClient.treatmentPlan.update.mockResolvedValue({
        ...mockPlan,
        status: 'cancelled',
      });

      const result = await service.cancel('plan-1', 'Patient changed mind');
      expect(result.status).toBe('cancelled');
    });
  });
});
