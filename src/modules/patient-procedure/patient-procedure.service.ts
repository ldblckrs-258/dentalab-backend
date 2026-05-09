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
import {
  ALLOWED_PROCEDURE_TRANSITIONS,
  DELETABLE_PROCEDURE_STATUSES,
  REASON_REQUIRED_STATUSES,
  type PatientProcedureStatus,
} from './constants/patient-procedure-transitions';
import {
  PATIENT_PROCEDURE_SELECT,
  PATIENT_PROCEDURE_DETAIL_SELECT,
  PATIENT_PROCEDURE_METADATA_SELECT,
} from './constants/patient-procedure-select';
import type { CreatePatientProcedureDto } from './dto/create-patient-procedure.dto';
import type { UpdatePatientProcedureDto } from './dto/update-patient-procedure.dto';
import type { TransitionPatientProcedureDto } from './dto/transition-patient-procedure.dto';
import type { LinkToAppointmentDto } from './dto/link-to-appointment.dto';
import type { FinalizeFeeDto } from './dto/finalize-fee.dto';
import type { PromoteToPlanDto } from './dto/promote-to-plan.dto';
import type { PatientProcedureQueryDto } from './dto/patient-procedure-query.dto';

// Procedures in these categories require an explicit tooth number (spec R9)
const TOOTH_REQUIRED_CATEGORIES = [
  'restorative',
  'surgical',
  'endodontic',
  'periodontic',
  'prosthodontic',
];

type ProcedureCoreFields = {
  id: string;
  status: string;
  plannedProviderId: string | null;
  performedByProviderId: string | null;
  appointmentId: string | null;
  actualFee: unknown;
  feeFinalizedAt: Date | null;
};

@Injectable()
export class PatientProcedureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissionResolver: PermissionResolverService,
    private readonly auditService: AuditService,
  ) {}

  async findAll(query: PatientProcedureQueryDto) {
    const prismaArgs = buildPrismaQuery(
      query,
      ['createdAt', 'status', 'scheduledAt', 'plannedAt', 'updatedAt'],
      { createdAt: 'desc' },
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

    const hasFullRead = userPermissions.includes(
      'patient_procedures:read:full',
    );
    const isReceptionist =
      !hasFullRead && !userPermissions.includes('patient_procedures:update');

    const where: Record<string, unknown> = { deletedAt: null };

    if (query.patientId) where.patientId = query.patientId;
    if (query.treatmentPlanId) where.treatmentPlanId = query.treatmentPlanId;
    if (query.appointmentId) where.appointmentId = query.appointmentId;
    if (query.status) {
      where.status = { in: query.status.split(',').filter(Boolean) };
    }

    if (doctorProvider && !hasFullRead && query.scope !== 'all') {
      where.OR = [
        { plannedProviderId: doctorProvider.id },
        { performedByProviderId: doctorProvider.id },
      ];
    }

    const select = isReceptionist
      ? PATIENT_PROCEDURE_METADATA_SELECT
      : PATIENT_PROCEDURE_SELECT;

    const [data, total] = await Promise.all([
      this.prisma.baseClient.patientProcedure.findMany({
        ...prismaArgs,
        where,
        select,
      }),
      this.prisma.baseClient.patientProcedure.count({ where }),
    ]);

    return buildPaginatedResponse(data, total, query);
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
    const hasFullRead = userPermissions.includes(
      'patient_procedures:read:full',
    );
    const isReceptionist =
      !hasFullRead && !userPermissions.includes('patient_procedures:update');

    const select = isReceptionist
      ? PATIENT_PROCEDURE_METADATA_SELECT
      : PATIENT_PROCEDURE_DETAIL_SELECT;

    const procedure = await this.prisma.baseClient.patientProcedure.findFirst({
      where: { id, deletedAt: null },
      select,
    });

    if (!procedure) {
      throw new NotFoundException(
        t(
          'patientProcedure.PROCEDURE_NOT_FOUND',
          'Patient procedure not found',
        ),
      );
    }

    return procedure;
  }

  async create(dto: CreatePatientProcedureDto) {
    const currentUserId = RequestContextService.getUserId();
    if (!currentUserId) {
      throw new ForbiddenException(
        t('common.no_user_context', 'No user context'),
      );
    }

    const catalogProcedure = await this.prisma.baseClient.procedure.findFirst({
      where: { id: dto.procedureId, isActive: true },
      select: { id: true, category: true, defaultFee: true },
    });

    if (!catalogProcedure) {
      throw new NotFoundException(
        t('procedure.not_found', 'Procedure not found or inactive'),
      );
    }

    if (
      catalogProcedure.category &&
      TOOTH_REQUIRED_CATEGORIES.includes(catalogProcedure.category) &&
      !dto.toothNumber
    ) {
      throw new ConflictException({
        message: t(
          'patientProcedure.PROCEDURE_TOOTH_REQUIRED',
          'A tooth number is required for this procedure category',
        ),
        errorCode: 'PROCEDURE_TOOTH_REQUIRED',
      });
    }

    const isAdHoc = !!dto.appointmentId && !dto.treatmentPlanId;
    const initialStatus: PatientProcedureStatus = isAdHoc
      ? 'in_progress'
      : 'planned';

    // Default provider from treatment plan when not explicitly specified (spec R15)
    let plannedProviderId = dto.plannedProviderId;
    if (!plannedProviderId && dto.treatmentPlanId) {
      const plan = await this.prisma.baseClient.treatmentPlan.findUnique({
        where: { id: dto.treatmentPlanId },
        select: { providerId: true },
      });
      if (plan) plannedProviderId = plan.providerId;
    }

    // Snapshot catalog fee if caller didn't provide one (spec R1)
    const estimatedFee =
      dto.estimatedFee !== undefined
        ? dto.estimatedFee
        : catalogProcedure.defaultFee !== null
          ? Number(catalogProcedure.defaultFee)
          : undefined;

    const now = new Date();

    return this.prisma.baseClient.patientProcedure.create({
      data: {
        patientId: dto.patientId,
        procedureId: dto.procedureId,
        treatmentPlanId: dto.treatmentPlanId,
        appointmentId: dto.appointmentId,
        plannedProviderId,
        toothNumber: dto.toothNumber,
        surface: dto.surface,
        diagnosis: dto.diagnosis,
        clinicalNotes: dto.clinicalNotes,
        estimatedFee,
        sequenceInPlan: dto.sequenceInPlan,
        status: initialStatus,
        plannedAt: !isAdHoc ? now : undefined,
        startedAt: isAdHoc ? now : undefined,
        createdBy: currentUserId,
      },
      select: PATIENT_PROCEDURE_DETAIL_SELECT,
    });
  }

  async update(id: string, dto: UpdatePatientProcedureDto) {
    const procedure = await this.findProcedureOrFail(id);
    await this.assertOwnProcedure(id, procedure);

    if (!['planned', 'scheduled'].includes(procedure.status)) {
      throw new ConflictException({
        message: t(
          'patientProcedure.PROCEDURE_IMMUTABLE_AFTER_COMPLETION',
          'Procedure cannot be edited after it has started or reached a terminal state',
        ),
        errorCode: 'PROCEDURE_IMMUTABLE_AFTER_COMPLETION',
      });
    }

    return this.prisma.baseClient.patientProcedure.update({
      where: { id },
      data: {
        plannedProviderId: dto.plannedProviderId,
        toothNumber: dto.toothNumber,
        surface: dto.surface,
        diagnosis: dto.diagnosis,
        clinicalNotes: dto.clinicalNotes,
        estimatedFee: dto.estimatedFee,
        sequenceInPlan: dto.sequenceInPlan,
      },
      select: PATIENT_PROCEDURE_DETAIL_SELECT,
    });
  }

  async transition(id: string, dto: TransitionPatientProcedureDto) {
    const procedure = await this.findProcedureOrFail(id);
    await this.assertOwnProcedure(id, procedure);
    await this.assertTransitionPermission(dto.to);

    const currentStatus = procedure.status as PatientProcedureStatus;
    const allowed = ALLOWED_PROCEDURE_TRANSITIONS[currentStatus] ?? [];

    if (!allowed.includes(dto.to)) {
      throw new ConflictException({
        message: t(
          'patientProcedure.PROCEDURE_INVALID_TRANSITION',
          `Cannot transition from '${currentStatus}' to '${dto.to}'`,
          { from: currentStatus, to: dto.to },
        ),
        errorCode: 'PROCEDURE_INVALID_TRANSITION',
      });
    }

    await this.assertAppointmentCouplingAllowed(
      dto.to,
      dto.appointmentId ?? procedure.appointmentId,
    );

    const updated = await this.applyTransition(id, dto);

    this.auditService.emit({
      code: 'PATIENT_PROCEDURE_TRANSITIONED',
      resource: 'patient_procedure',
      resourceId: id,
      metadata: {
        from: currentStatus,
        to: dto.to,
        reason: dto.cancellationReason,
      },
    });

    return updated;
  }

  async linkToAppointment(id: string, dto: LinkToAppointmentDto) {
    const procedure = await this.findProcedureOrFail(id);
    await this.assertOwnProcedure(id, procedure);

    if (procedure.status !== 'planned') {
      throw new ConflictException({
        message: t(
          'patientProcedure.PROCEDURE_MUST_BE_PLANNED_TO_LINK',
          'Only planned procedures can be linked to an appointment',
        ),
        errorCode: 'PROCEDURE_INVALID_TRANSITION',
      });
    }

    const appointment = await this.prisma.baseClient.appointment.findFirst({
      where: { id: dto.appointmentId },
      select: { id: true, status: true, providerId: true },
    });

    if (!appointment || appointment.status === 'cancelled') {
      throw new NotFoundException(
        t('appointment.not_found', 'Appointment not found or cancelled'),
      );
    }

    const result = await this.applyTransition(id, {
      to: 'scheduled',
      appointmentId: dto.appointmentId,
    });

    // R16: include mismatch flag when planned provider differs from appointment provider (non-blocking)
    const providerMismatch =
      !!procedure.plannedProviderId &&
      procedure.plannedProviderId !== appointment.providerId;

    this.auditService.emit({
      code: 'PATIENT_PROCEDURE_LINKED',
      resource: 'patient_procedure',
      resourceId: id,
      metadata: {
        appointmentId: dto.appointmentId,
        ...(providerMismatch && {
          providerMismatch: true,
          plannedProviderId: procedure.plannedProviderId,
          appointmentProviderId: appointment.providerId,
        }),
      },
    });

    return result;
  }

  async unlinkFromAppointment(id: string) {
    const procedure = await this.findProcedureOrFail(id);
    await this.assertOwnProcedure(id, procedure);

    if (procedure.status !== 'scheduled') {
      throw new ConflictException({
        message: t(
          'patientProcedure.PROCEDURE_MUST_BE_SCHEDULED_TO_UNLINK',
          'Only scheduled procedures can be unlinked from an appointment',
        ),
        errorCode: 'PROCEDURE_INVALID_TRANSITION',
      });
    }

    const previousAppointmentId = procedure.appointmentId;

    const result = await this.applyTransition(id, { to: 'planned' });

    this.auditService.emit({
      code: 'PATIENT_PROCEDURE_UNLINKED',
      resource: 'patient_procedure',
      resourceId: id,
      metadata: { previousAppointmentId },
    });

    return result;
  }

  async finalizeFee(id: string, dto: FinalizeFeeDto) {
    const procedure = await this.findProcedureOrFail(id);
    const now = new Date();

    if (procedure.feeFinalizedAt !== null) {
      const userId = RequestContextService.getUserId();
      if (!userId) {
        throw new ForbiddenException(
          t('common.no_user_context', 'No user context'),
        );
      }
      const userPermissions =
        await this.permissionResolver.resolvePermissions(userId);

      if (
        !userPermissions.includes('patient_procedures:finalize_fee:override')
      ) {
        throw new ConflictException({
          message: t(
            'patientProcedure.PROCEDURE_FEE_ALREADY_FINALIZED',
            'Fee has already been finalized. Override permission required.',
          ),
          errorCode: 'PROCEDURE_FEE_ALREADY_FINALIZED',
        });
      }

      if (!dto.reason) {
        throw new ConflictException({
          message: t(
            'patientProcedure.PROCEDURE_FEE_OVERRIDE_REASON_REQUIRED',
            'A reason is required to override a finalized fee',
          ),
          errorCode: 'PROCEDURE_FEE_ALREADY_FINALIZED',
        });
      }

      const previousFee = procedure.actualFee;

      const updated = await this.prisma.baseClient.patientProcedure.update({
        where: { id },
        data: { actualFee: dto.actualFee, feeFinalizedAt: now },
        select: PATIENT_PROCEDURE_DETAIL_SELECT,
      });

      this.auditService.emit({
        code: 'PATIENT_PROCEDURE_FEE_OVERRIDDEN',
        resource: 'patient_procedure',
        resourceId: id,
        reason: dto.reason,
        metadata: { previousFee, newFee: dto.actualFee, reason: dto.reason },
      });

      return updated;
    }

    const updated = await this.prisma.baseClient.patientProcedure.update({
      where: { id },
      data: { actualFee: dto.actualFee, feeFinalizedAt: now },
      select: PATIENT_PROCEDURE_DETAIL_SELECT,
    });

    this.auditService.emit({
      code: 'PATIENT_PROCEDURE_FEE_FINALIZED',
      resource: 'patient_procedure',
      resourceId: id,
      metadata: { actualFee: dto.actualFee },
    });

    return updated;
  }

  async promoteToTreatmentPlan(id: string, dto: PromoteToPlanDto) {
    const [, plan] = await Promise.all([
      this.findProcedureOrFail(id),
      this.prisma.baseClient.treatmentPlan.findUnique({
        where: { id: dto.treatmentPlanId },
        select: { id: true },
      }),
    ]);

    if (!plan) {
      throw new NotFoundException(
        t('treatmentPlan.not_found', 'Treatment plan not found'),
      );
    }

    const updated = await this.prisma.baseClient.patientProcedure.update({
      where: { id },
      data: { treatmentPlanId: dto.treatmentPlanId },
      select: PATIENT_PROCEDURE_DETAIL_SELECT,
    });

    this.auditService.emit({
      code: 'PATIENT_PROCEDURE_PROMOTED_TO_PLAN',
      resource: 'patient_procedure',
      resourceId: id,
      metadata: { treatmentPlanId: dto.treatmentPlanId },
    });

    return updated;
  }

  async softDelete(id: string) {
    const procedure = await this.findProcedureOrFail(id);
    await this.assertOwnProcedure(id, procedure);

    if (
      !DELETABLE_PROCEDURE_STATUSES.includes(
        procedure.status as PatientProcedureStatus,
      )
    ) {
      throw new ConflictException({
        message: t(
          'patientProcedure.PROCEDURE_CANNOT_DELETE_COMPLETED',
          'Only planned, scheduled, or cancelled procedures can be deleted',
        ),
        errorCode: 'PROCEDURE_CANNOT_DELETE_COMPLETED',
      });
    }

    await this.prisma.baseClient.patientProcedure.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    this.auditService.emit({
      code: 'PATIENT_PROCEDURE_DELETED',
      resource: 'patient_procedure',
      resourceId: id,
    });

    return { id };
  }

  // Validates business rules and applies the state change. Does not emit audit events —
  // callers are responsible for emitting the appropriate event with richer context.
  private async applyTransition(
    id: string,
    dto: TransitionPatientProcedureDto,
  ) {
    if (dto.to === 'completed') {
      if (dto.actualFee === undefined || dto.actualFee === null) {
        throw new ConflictException({
          message: t(
            'patientProcedure.PROCEDURE_ACTUAL_FEE_REQUIRED',
            'Actual fee is required to complete a procedure',
          ),
          errorCode: 'PROCEDURE_ACTUAL_FEE_REQUIRED',
        });
      }
      if (!dto.performedByProviderId) {
        throw new ConflictException({
          message: t(
            'patientProcedure.PROCEDURE_PERFORMED_BY_REQUIRED',
            'Performing provider is required to complete a procedure',
          ),
          errorCode: 'PROCEDURE_PERFORMED_BY_REQUIRED',
        });
      }
    }

    if (REASON_REQUIRED_STATUSES.includes(dto.to) && !dto.cancellationReason) {
      throw new ConflictException({
        message: t(
          'patientProcedure.PROCEDURE_REASON_REQUIRED',
          'A reason is required when cancelling or marking a procedure as failed',
        ),
        errorCode: 'PROCEDURE_INVALID_TRANSITION',
      });
    }

    const now = new Date();
    const updateData: Record<string, unknown> = { status: dto.to };

    switch (dto.to) {
      case 'scheduled':
        updateData.scheduledAt = now;
        if (dto.appointmentId) updateData.appointmentId = dto.appointmentId;
        break;
      case 'planned':
        updateData.appointmentId = null;
        updateData.scheduledAt = null;
        break;
      case 'in_progress':
        updateData.startedAt = now;
        if (dto.performedByProviderId) {
          updateData.performedByProviderId = dto.performedByProviderId;
        }
        break;
      case 'completed':
        updateData.completedAt = now;
        updateData.actualFee = dto.actualFee;
        updateData.performedByProviderId = dto.performedByProviderId;
        break;
      case 'cancelled':
      case 'failed':
        updateData.cancelledAt = now;
        updateData.cancellationReason = dto.cancellationReason;
        break;
    }

    return this.prisma.baseClient.patientProcedure.update({
      where: { id },
      data: updateData,
      select: PATIENT_PROCEDURE_DETAIL_SELECT,
    });
  }

  private async findProcedureOrFail(id: string): Promise<ProcedureCoreFields> {
    const procedure = await this.prisma.baseClient.patientProcedure.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        status: true,
        plannedProviderId: true,
        performedByProviderId: true,
        appointmentId: true,
        actualFee: true,
        feeFinalizedAt: true,
      },
    });

    if (!procedure) {
      throw new NotFoundException({
        message: t(
          'patientProcedure.PROCEDURE_NOT_FOUND',
          'Patient procedure not found',
        ),
        errorCode: 'PROCEDURE_NOT_FOUND',
      });
    }

    return procedure;
  }

  // Maps a target status to the permission required to perform the transition (spec §6.2)
  private async assertTransitionPermission(to: PatientProcedureStatus) {
    const permissionByStatus: Record<PatientProcedureStatus, string> = {
      planned: 'patient_procedures:update',
      scheduled: 'patient_procedures:update',
      in_progress: 'patient_procedures:update',
      completed: 'patient_procedures:complete',
      cancelled: 'patient_procedures:cancel',
      failed: 'patient_procedures:cancel',
    };

    const required = permissionByStatus[to];
    if (!required) return;

    const userId = RequestContextService.getUserId();
    if (!userId) return;

    const userPermissions =
      await this.permissionResolver.resolvePermissions(userId);

    if (!userPermissions.includes(required)) {
      throw new ForbiddenException({
        message: t(
          'patientProcedure.PROCEDURE_INSUFFICIENT_PERMISSION_FOR_TRANSITION',
          `Permission '${required}' is required to transition to '${to}'`,
          { required, to },
        ),
        errorCode: 'INSUFFICIENT_PERMISSIONS',
      });
    }
  }

  // Validates the linked appointment status is compatible with the target procedure status (spec §4.3, §8.2 step 4)
  private async assertAppointmentCouplingAllowed(
    to: PatientProcedureStatus,
    appointmentId: string | null | undefined,
  ) {
    if (!appointmentId) return;
    if (to === 'cancelled' || to === 'failed' || to === 'planned') return;

    const appointment = await this.prisma.baseClient.appointment.findUnique({
      where: { id: appointmentId },
      select: { id: true, status: true },
    });
    if (!appointment) return;

    const allowedAppointmentStatusesByProcedureTarget: Record<
      PatientProcedureStatus,
      string[]
    > = {
      planned: [],
      scheduled: ['scheduled', 'confirmed', 'checked_in', 'in_progress'],
      in_progress: ['in_progress'],
      completed: ['in_progress', 'completed'],
      cancelled: [],
      failed: [],
    };

    const allowed = allowedAppointmentStatusesByProcedureTarget[to];
    if (allowed.length > 0 && !allowed.includes(appointment.status)) {
      throw new ConflictException({
        message: t(
          'patientProcedure.PROCEDURE_APPOINTMENT_STATUS_INCOMPATIBLE',
          `Cannot transition procedure to '${to}' while linked appointment is '${appointment.status}'`,
          { to, appointmentStatus: appointment.status },
        ),
        errorCode: 'PROCEDURE_INVALID_TRANSITION',
      });
    }
  }

  private async assertOwnProcedure(
    id: string,
    procedure?: {
      plannedProviderId: string | null;
      performedByProviderId: string | null;
    },
  ) {
    const currentUserId = RequestContextService.getUserId();
    if (!currentUserId) return;

    const provider = await this.prisma.baseClient.provider.findUnique({
      where: { userId: currentUserId },
      select: { id: true },
    });

    if (!provider) return;

    const userPermissions =
      await this.permissionResolver.resolvePermissions(currentUserId);
    if (userPermissions.includes('patient_procedures:read:full')) return;

    const rec =
      procedure ??
      (await this.prisma.baseClient.patientProcedure.findFirst({
        where: { id, deletedAt: null },
        select: { plannedProviderId: true, performedByProviderId: true },
      }));

    if (!rec) return;

    if (
      rec.plannedProviderId !== provider.id &&
      rec.performedByProviderId !== provider.id
    ) {
      throw new ForbiddenException({
        message: t(
          'patientProcedure.PROCEDURE_NOT_OWNED_BY_DOCTOR',
          'You can only modify procedures assigned to you',
        ),
        errorCode: 'PROCEDURE_NOT_OWNED_BY_DOCTOR',
      });
    }
  }
}
