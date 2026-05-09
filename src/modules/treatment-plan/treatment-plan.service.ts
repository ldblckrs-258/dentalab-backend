import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@modules/database';
import { buildPrismaQuery, buildPaginatedResponse } from '@modules/pagination';
import { PermissionResolverService } from '@modules/rbac/services/permission-resolver.service';
import { AuditService } from '@modules/audit';
import { RequestContextService } from '@modules/common/context/request-context';
import { t } from '@common/utils';
import type { CreateTreatmentPlanDto } from './dto/create-treatment-plan.dto';
import type { UpdateTreatmentPlanDto } from './dto/update-treatment-plan.dto';
import type { TransitionTreatmentPlanDto } from './dto/transition-treatment-plan.dto';
import type { TreatmentPlanQueryDto } from './dto/treatment-plan-query.dto';

const TREATMENT_PLAN_SELECT = {
  id: true,
  patientId: true,
  providerId: true,
  name: true,
  status: true,
  startDate: true,
  endDate: true,
  createdAt: true,
} as const;

const TREATMENT_PLAN_DETAIL_SELECT = {
  ...TREATMENT_PLAN_SELECT,
  notes: true,
  updatedAt: true,
} as const;

const TREATMENT_PLAN_METADATA_SELECT = {
  id: true,
  patientId: true,
  providerId: true,
  name: true,
  status: true,
  startDate: true,
  endDate: true,
  updatedAt: true,
} as const;

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  draft: ['proposed'],
  proposed: ['accepted', 'draft'],
  accepted: ['in_progress', 'draft'],
  in_progress: ['completed', 'draft'],
  completed: [],
  cancelled: [],
};

@Injectable()
export class TreatmentPlanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissionResolver: PermissionResolverService,
    private readonly auditService: AuditService,
  ) {}

  async findAll(query: TreatmentPlanQueryDto) {
    const prismaArgs = buildPrismaQuery(
      query,
      ['createdAt', 'name', 'status', 'startDate', 'updatedAt'],
      { updatedAt: 'desc' },
    );

    const userId = RequestContextService.getUserId();
    if (!userId) {
      throw new ForbiddenException(
        t('common.no_user_context', 'No user context'),
      );
    }

    const [userPermissions, doctorProvider] = await Promise.all([
      this.permissionResolver.resolvePermissions(userId),
      this.prisma.baseClient.provider.findUnique({
        where: { userId },
        select: { id: true },
      }),
    ]);

    const hasFullRead = userPermissions.includes('treatment_plans:read:full');

    const where: Record<string, unknown> = {};

    if (query.scope === 'all') {
      if (!hasFullRead) {
        throw new ForbiddenException(
          t(
            'treatmentPlan.insufficient_permissions',
            'Insufficient permissions for cross-doctor scope',
          ),
        );
      }
    } else if (doctorProvider) {
      where.providerId = doctorProvider.id;
    }

    if (query.search) {
      where.name = { contains: query.search, mode: 'insensitive' };
    }
    if (query.status) {
      where.status = { in: query.status.split(',').filter(Boolean) };
    }
    if (query.patientId) {
      where.patientId = query.patientId;
    }
    if (query.providerId) {
      where.providerId = query.providerId;
    }

    const [data, total] = await Promise.all([
      this.prisma.baseClient.treatmentPlan.findMany({
        ...prismaArgs,
        where,
        select: {
          ...TREATMENT_PLAN_SELECT,
          patient: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              deletedAt: true,
            },
          },
          provider: {
            select: { id: true, user: { select: { fullName: true } } },
          },
        },
      }),
      this.prisma.baseClient.treatmentPlan.count({ where }),
    ]);

    const costSummaries = hasFullRead
      ? await this.fetchCostSummaries(data.map((p) => p.id))
      : null;

    const items = data.map((plan) => {
      const summary = costSummaries?.get(plan.id);
      return {
        ...plan,
        patientName: plan.patient.deletedAt
          ? t('patient.deletedPlaceholder', 'Deleted Patient')
          : `${plan.patient.lastName} ${plan.patient.firstName}`,
        providerName: plan.provider.user.fullName,
        ...(summary && {
          estimatedTotalCost: summary.estimatedTotal,
          actualTotalCost: summary.actualTotal,
          completedCount: summary.completedCount,
          totalCount: summary.totalCount,
        }),
      };
    });

    return buildPaginatedResponse(items, total, query);
  }

  async findById(id: string) {
    const userId = RequestContextService.getUserId();
    if (!userId) {
      throw new ForbiddenException(
        t('common.no_user_context', 'No user context'),
      );
    }

    const userPermissions =
      await this.permissionResolver.resolvePermissions(userId);
    const hasFullRead = userPermissions.includes('treatment_plans:read:full');

    const plan = await this.prisma.baseClient.treatmentPlan.findUnique({
      where: { id },
      select: {
        ...(hasFullRead
          ? TREATMENT_PLAN_DETAIL_SELECT
          : TREATMENT_PLAN_METADATA_SELECT),
        patient: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            deletedAt: true,
          },
        },
        provider: {
          select: { id: true, user: { select: { fullName: true } } },
        },
      },
    });

    if (!plan) {
      throw new NotFoundException(
        t('treatmentPlan.not_found', 'Treatment plan not found'),
      );
    }

    const result: Record<string, unknown> = {
      ...plan,
      patientName: plan.patient.deletedAt
        ? t('patient.deletedPlaceholder', 'Deleted Patient')
        : `${plan.patient.lastName} ${plan.patient.firstName}`,
      providerName: plan.provider.user.fullName,
    };

    if (hasFullRead) {
      // Direct query until cost aggregation is delegated to PatientProcedureService (Phase 2).
      const costSummary = await this.prisma.baseClient.$queryRaw<
        { estimated_total: string; actual_total: string }[]
      >`SELECT estimated_total, actual_total FROM treatment_plan_cost_summary WHERE treatment_plan_id = ${id}::uuid`;

      const estimatedTotal = Number(costSummary[0]?.estimated_total ?? 0);
      const actualTotal = Number(costSummary[0]?.actual_total ?? 0);

      result.estimatedTotalCost = estimatedTotal;
      result.actualTotalCost = actualTotal;
      result.variance = actualTotal - estimatedTotal;
    }

    return result;
  }

  async create(dto: CreateTreatmentPlanDto) {
    const currentUserId = RequestContextService.getUserId();

    const provider = await this.prisma.baseClient.provider.findUnique({
      where: { userId: currentUserId },
      select: { id: true },
    });

    if (!provider) {
      throw new ForbiddenException(
        t(
          'treatmentPlan.not_a_provider',
          'Only providers can create treatment plans',
        ),
      );
    }

    const patient = await this.prisma.baseClient.patient.findFirst({
      where: { id: dto.patientId, deletedAt: null },
      select: { id: true },
    });

    if (!patient) {
      throw new NotFoundException(t('patient.not_found', 'Patient not found'));
    }

    if (
      dto.startDate &&
      dto.endDate &&
      new Date(dto.startDate) > new Date(dto.endDate)
    ) {
      throw new ConflictException(
        t(
          'treatmentPlan.invalid_date_range',
          'startDate must be before or equal to endDate',
        ),
      );
    }

    return this.prisma.baseClient.treatmentPlan.create({
      data: {
        patientId: dto.patientId,
        providerId: provider.id,
        name: dto.name,
        status: 'draft',
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
        notes: dto.notes,
      },
      select: TREATMENT_PLAN_DETAIL_SELECT,
    });
  }

  async update(id: string, dto: UpdateTreatmentPlanDto) {
    const plan = await this.findPlanOrFail(id);
    await this.assertOwnPlan(id);

    const isLocked = !['draft', 'proposed'].includes(plan.status);

    if (isLocked) {
      const changedFields = Object.keys(dto).filter(
        (k) => k !== 'notes' && k !== 'endDate' && k !== 'consentSignedBy',
      );
      if (changedFields.length > 0) {
        throw new ConflictException({
          message: t(
            'treatmentPlan.edit_locked',
            'Treatment plan is locked. Only notes and endDate can be changed after acceptance.',
          ),
          errorCode: 'TREATMENT_PLAN_EDIT_LOCKED',
        });
      }
    }

    return this.prisma.baseClient.treatmentPlan.update({
      where: { id },
      data: {
        name: dto.name,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
        notes: dto.notes,
        consentSignedBy: dto.consentSignedBy,
        consentSignedAt:
          dto.consentSignedBy && !plan.consentSignedAt ? new Date() : undefined,
      },
      select: TREATMENT_PLAN_DETAIL_SELECT,
    });
  }

  async transition(id: string, dto: TransitionTreatmentPlanDto) {
    const plan = await this.findPlanOrFail(id);
    await this.assertOwnPlan(id);

    const allowed = ALLOWED_TRANSITIONS[plan.status] ?? [];
    if (!allowed.includes(dto.to)) {
      throw new ConflictException({
        message: t(
          'treatmentPlan.invalid_transition',
          `Cannot transition from '${plan.status}' to '${dto.to}'`,
        ),
        errorCode: 'INVALID_TREATMENT_PLAN_TRANSITION',
      });
    }

    if (
      dto.to === 'accepted' &&
      (!plan.consentSignedAt || !plan.consentSignedBy)
    ) {
      throw new ConflictException({
        message: t(
          'patientProcedure.TREATMENT_PLAN_CONSENT_REQUIRED',
          'Consent signature is required to accept the treatment plan',
        ),
        errorCode: 'TREATMENT_PLAN_CONSENT_REQUIRED',
      });
    }

    return this.prisma.transaction(async (tx) => {
      if (dto.to === 'in_progress') {
        const activeCount = await tx.patientProcedure.count({
          where: {
            treatmentPlanId: id,
            status: { in: ['scheduled', 'in_progress'] },
            deletedAt: null,
          },
        });
        if (activeCount < 1) {
          throw new ConflictException({
            message: t(
              'treatmentPlan.procedure_required_for_start',
              'At least one scheduled or in-progress procedure is required to start a treatment plan',
            ),
            errorCode: 'INVALID_TREATMENT_PLAN_TRANSITION',
          });
        }
      }

      if (dto.to === 'completed') {
        const incompleteProcedures = await tx.patientProcedure.count({
          where: {
            treatmentPlanId: id,
            status: { notIn: ['completed', 'failed', 'cancelled'] },
            deletedAt: null,
          },
        });
        if (incompleteProcedures > 0) {
          throw new ConflictException({
            message: t(
              'treatmentPlan.procedures_not_completed',
              'All procedures must be completed, failed, or cancelled before completing the plan',
            ),
            errorCode: 'INVALID_TREATMENT_PLAN_TRANSITION',
          });
        }
      }

      return tx.treatmentPlan.update({
        where: { id },
        data: { status: dto.to },
        select: TREATMENT_PLAN_DETAIL_SELECT,
      });
    });
  }

  async cancel(id: string, reason: string) {
    await this.assertOwnPlan(id);

    const updated = await this.prisma.transaction(async (tx) => {
      // Cascade cancel linked procedures in planned/scheduled (spec §4.2)
      await tx.patientProcedure.updateMany({
        where: {
          treatmentPlanId: id,
          status: { in: ['planned', 'scheduled'] },
          deletedAt: null,
        },
        data: {
          status: 'cancelled',
          cancelledAt: new Date(),
          cancellationReason: 'Treatment plan cancelled',
        },
      });

      return tx.treatmentPlan.update({
        where: { id },
        data: {
          status: 'cancelled',
          cancelledAt: new Date(),
          cancellationReason: reason,
        },
        select: TREATMENT_PLAN_DETAIL_SELECT,
      });
    });

    this.auditService.emit({
      code: 'TREATMENT_PLAN_CANCELLED',
      resource: 'treatment_plan',
      resourceId: id,
      metadata: { reason },
    });

    return updated;
  }

  async findByPatientId(patientId: string, currentUser?: { userId?: string }) {
    const prismaArgs = buildPrismaQuery(
      {} as TreatmentPlanQueryDto,
      ['createdAt', 'name', 'status', 'startDate', 'updatedAt'],
      { updatedAt: 'desc' },
    );

    const currentUserId =
      currentUser?.userId ?? RequestContextService.getUserId();

    const [userPermissions, doctorProvider] = await Promise.all([
      currentUserId
        ? this.permissionResolver.resolvePermissions(currentUserId)
        : Promise.resolve([] as string[]),
      this.prisma.baseClient.provider.findUnique({
        where: { userId: currentUserId },
        select: { id: true },
      }),
    ]);

    const hasFullRead = userPermissions.includes('treatment_plans:read:full');

    const where: Record<string, unknown> = { patientId };
    if (doctorProvider && !hasFullRead) {
      where.providerId = doctorProvider.id;
    }

    const [data, total] = await Promise.all([
      this.prisma.baseClient.treatmentPlan.findMany({
        ...prismaArgs,
        where,
        select: {
          ...TREATMENT_PLAN_SELECT,
          patient: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              deletedAt: true,
            },
          },
          provider: {
            select: { id: true, user: { select: { fullName: true } } },
          },
        },
      }),
      this.prisma.baseClient.treatmentPlan.count({ where }),
    ]);

    const costSummaries = hasFullRead
      ? await this.fetchCostSummaries(data.map((p) => p.id))
      : null;

    const items = data.map((plan) => {
      const summary = costSummaries?.get(plan.id);
      return {
        ...plan,
        patientName: plan.patient.deletedAt
          ? t('patient.deletedPlaceholder', 'Deleted Patient')
          : `${plan.patient.lastName} ${plan.patient.firstName}`,
        providerName: plan.provider.user.fullName,
        ...(summary && {
          estimatedTotalCost: summary.estimatedTotal,
          actualTotalCost: summary.actualTotal,
          completedCount: summary.completedCount,
          totalCount: summary.totalCount,
        }),
      };
    });

    return buildPaginatedResponse(items, total, {} as TreatmentPlanQueryDto);
  }

  // Batched lookup of cost summaries for a set of plan IDs from the
  // treatment_plan_cost_summary view. Returns Map<planId, summary>.
  private async fetchCostSummaries(planIds: string[]) {
    const result = new Map<
      string,
      {
        estimatedTotal: number;
        actualTotal: number;
        completedCount: number;
        totalCount: number;
      }
    >();
    if (planIds.length === 0) return result;

    const rows = await this.prisma.baseClient.$queryRaw<
      {
        treatment_plan_id: string;
        estimated_total: string;
        actual_total: string;
        completed_count: bigint;
        total_count: bigint;
      }[]
    >`SELECT treatment_plan_id, estimated_total, actual_total, completed_count, total_count
      FROM treatment_plan_cost_summary
      WHERE treatment_plan_id = ANY(${planIds}::uuid[])`;

    for (const row of rows) {
      result.set(row.treatment_plan_id, {
        estimatedTotal: Number(row.estimated_total ?? 0),
        actualTotal: Number(row.actual_total ?? 0),
        completedCount: Number(row.completed_count ?? 0),
        totalCount: Number(row.total_count ?? 0),
      });
    }
    return result;
  }

  private async findPlanOrFail(id: string) {
    const plan = await this.prisma.baseClient.treatmentPlan.findUnique({
      where: { id },
      select: {
        id: true,
        providerId: true,
        status: true,
        notes: true,
        consentSignedAt: true,
        consentSignedBy: true,
      },
    });

    if (!plan) {
      throw new NotFoundException(
        t('treatmentPlan.not_found', 'Treatment plan not found'),
      );
    }

    return plan;
  }

  private async assertOwnPlan(id: string) {
    const currentUserId = RequestContextService.getUserId();
    const provider = await this.prisma.baseClient.provider.findUnique({
      where: { userId: currentUserId },
      select: { id: true },
    });

    if (!provider) {
      throw new ForbiddenException(
        t(
          'treatmentPlan.not_a_provider',
          'Only providers can modify treatment plans',
        ),
      );
    }

    const plan = await this.prisma.baseClient.treatmentPlan.findUnique({
      where: { id },
      select: { providerId: true },
    });

    if (!plan) {
      throw new NotFoundException(
        t('treatmentPlan.not_found', 'Treatment plan not found'),
      );
    }

    if (plan.providerId !== provider.id) {
      throw new ForbiddenException(
        t(
          'treatmentPlan.not_own_plan',
          'You can only modify your own treatment plans',
        ),
      );
    }
  }
}
