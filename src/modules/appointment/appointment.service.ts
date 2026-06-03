import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '@modules/database';
import { ProviderAvailabilityService } from '@modules/scheduling/provider-availability.service';
import { SchedulingGateway } from '@modules/scheduling/scheduling.gateway';
import { RequestContextService } from '@modules/common/context/request-context';
import { t } from '@common/utils';
import { DEFAULT_TIMEZONE } from '@common/constants/app.constants';
import { tryMapConflict } from './appointment-conflict.mapper';
import { AppointmentEmailProducer } from './appointment-email.producer';
import type { Appointment, Prisma } from '@prisma/client';
import type { CreateAppointmentDto } from './dto/create-appointment.dto';
import type { CancelAppointmentDto } from './dto/cancel-appointment.dto';
import type { RescheduleAppointmentDto } from './dto/reschedule-appointment.dto';
import type { UpdateAppointmentDto } from './dto/update-appointment.dto';
import type { ListAppointmentsQueryDto } from './dto/list-appointments-query.dto';
import type {
  TransitionStatusDto,
  TransitionableStatus,
} from './dto/transition-status.dto';

const STATUS_TRANSITION_MATRIX: Record<string, TransitionableStatus[]> = {
  scheduled: ['confirmed', 'checked_in', 'in_progress', 'completed', 'no_show'],
  confirmed: ['checked_in', 'in_progress', 'completed', 'no_show'],
  checked_in: ['in_progress', 'completed', 'no_show'],
  in_progress: ['completed', 'no_show'],
  completed: [],
  cancelled: [],
  no_show: [],
};

const CLINIC_TIMEZONE = DEFAULT_TIMEZONE;

const HHMM_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  timeZone: CLINIC_TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function toHHmm(date: Date): string {
  const parts = HHMM_FORMATTER.formatToParts(date);
  const h = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const m = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${h}:${m}`;
}

function compareHHmm(a: string, b: string): number {
  return a.localeCompare(b);
}

const APPOINTMENT_INCLUDE = {
  appointmentType: {
    select: {
      id: true,
      name: true,
      color: true,
      textColor: true,
      durationMinutes: true,
    },
  },
  patient: { select: { id: true, firstName: true, lastName: true } },
  provider: {
    select: {
      id: true,
      user: { select: { id: true, fullName: true } },
    },
  },
  patientProcedures: {
    where: { deletedAt: null },
    select: {
      id: true,
      status: true,
      procedure: { select: { id: true, adaCode: true, name: true } },
    },
  },
  _count: {
    select: { patientProcedures: { where: { deletedAt: null } } },
  },
} as const;

@Injectable()
export class AppointmentService {
  private readonly logger = new Logger(AppointmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly availability: ProviderAvailabilityService,
    private readonly gateway: SchedulingGateway,
    private readonly emailProducer: AppointmentEmailProducer,
  ) {}

  async create(dto: CreateAppointmentDto) {
    const currentUserId = RequestContextService.getUserId();
    if (!currentUserId) {
      throw new UnauthorizedException();
    }

    const type = await this.prisma.baseClient.appointmentType.findUnique({
      where: { id: dto.typeId },
      select: { id: true, durationMinutes: true, isActive: true },
    });
    if (!type)
      throw new NotFoundException(
        t('appointment.TYPE_NOT_FOUND', 'Appointment type not found'),
      );
    if (!type.isActive)
      throw new BadRequestException(
        t('appointment.TYPE_INACTIVE', 'Appointment type is inactive'),
      );

    const durationMs = (dto.durationMinutes ?? type.durationMinutes) * 60_000;
    const startTime = new Date(dto.startTime);
    const endTime = new Date(startTime.getTime() + durationMs);

    const [patient, provider] = await Promise.all([
      this.prisma.baseClient.patient.findFirst({
        where: { id: dto.patientId, deletedAt: null },
        select: { id: true },
      }),
      this.prisma.baseClient.provider.findFirst({
        where: { id: dto.providerId, isActive: true },
        select: { id: true },
      }),
    ]);
    if (!patient)
      throw new NotFoundException(
        t('appointment.PATIENT_NOT_FOUND', 'Patient not found'),
      );
    if (!provider)
      throw new NotFoundException(
        t('appointment.PROVIDER_NOT_FOUND', 'Provider not found or inactive'),
      );

    await this.validateAvailability(dto.providerId, startTime, endTime);

    const { appt, emit } = await this.createAppointmentCore(
      {
        patientId: dto.patientId,
        providerId: dto.providerId,
        typeId: dto.typeId,
        startTime,
        endTime,
        status: 'scheduled',
        bookingSource: 'staff',
        notes: dto.notes,
        chiefComplaint: dto.chiefComplaint,
        procedureIds: dto.procedureIds,
      },
      currentUserId,
    );

    this.runEmit(emit);

    return this.findById(appt.id);
  }

  /**
   * Insert an appointment (and optionally link procedures), then return the row
   * plus a deferred `emit` that performs the gateway + email side-effects.
   *
   * When `tx` is provided, the inserts run on the caller's transaction and the
   * raw exclusion violation (23P01) is allowed to propagate so the caller can map
   * it AFTER its transaction rolls back — running tryMapConflict before rollback
   * would re-query a not-yet-rolled-back state and rethrow raw. When `tx` is
   * absent, this opens its own transaction and maps the conflict inline.
   *
   * The caller must invoke `emit()` only after the relevant transaction commits;
   * no side-effect may fire on rollback.
   */
  async createAppointmentCore(
    input: {
      patientId: string;
      providerId: string;
      typeId: string;
      startTime: Date;
      endTime: Date;
      status: string;
      bookingSource: string;
      notes?: string;
      chiefComplaint?: string;
      procedureIds?: string[];
    },
    createdById: string | null,
    tx?: Prisma.TransactionClient,
  ): Promise<{ appt: Appointment; emit: () => void }> {
    const insert = async (
      client: Prisma.TransactionClient,
    ): Promise<Appointment> => {
      const appt = await client.appointment.create({
        data: {
          patientId: input.patientId,
          providerId: input.providerId,
          typeId: input.typeId,
          createdBy: createdById,
          startTime: input.startTime,
          endTime: input.endTime,
          status: input.status,
          bookingSource: input.bookingSource,
          notes: input.notes,
          chiefComplaint: input.chiefComplaint,
        },
      });

      if (input.procedureIds && input.procedureIds.length > 0) {
        const procedures = await client.patientProcedure.findMany({
          where: { id: { in: input.procedureIds } },
          select: {
            id: true,
            patientId: true,
            status: true,
            appointmentId: true,
            deletedAt: true,
          },
        });

        const foundIds = new Set(procedures.map((p) => p.id));
        const missingIds = input.procedureIds.filter((id) => !foundIds.has(id));
        if (missingIds.length > 0) {
          throw new BadRequestException(
            t(
              'appointment.PROCEDURES_NOT_FOUND',
              `Procedure(s) not found: ${missingIds.join(', ')}`,
              { args: { ids: missingIds.join(', ') } },
            ),
          );
        }

        const invalidIds = procedures
          .filter(
            (p) =>
              p.patientId !== input.patientId ||
              p.status !== 'planned' ||
              p.appointmentId !== null ||
              p.deletedAt !== null,
          )
          .map((p) => p.id);

        if (invalidIds.length > 0) {
          throw new BadRequestException(
            t(
              'appointment.PROCEDURES_INVALID',
              `Procedure(s) cannot be linked (wrong patient, not planned, already linked, or deleted): ${invalidIds.join(', ')}`,
              { args: { ids: invalidIds.join(', ') } },
            ),
          );
        }

        await client.patientProcedure.updateMany({
          where: { id: { in: input.procedureIds } },
          data: { appointmentId: appt.id },
        });
      }

      return appt;
    };

    let created: Appointment;
    if (tx) {
      // External transaction: propagate the raw 23P01 so the caller maps it
      // after its own rollback.
      created = await insert(tx);
    } else {
      try {
        created = await this.prisma.transaction((client) => insert(client));
      } catch (err) {
        await tryMapConflict(err, {
          db: this.prisma.baseClient,
          providerId: input.providerId,
          startTime: input.startTime,
          endTime: input.endTime,
        });
        throw err;
      }
    }

    const emit = () => {
      this.gateway.emitAppointmentCreated({
        id: created.id,
        providerId: created.providerId,
        startTime: created.startTime.toISOString(),
        endTime: created.endTime.toISOString(),
      });
      void this.emailProducer.publishCreated(created.id);
    };

    return { appt: created, emit };
  }

  private runEmit(emit: () => void): void {
    try {
      emit();
    } catch (err) {
      this.logger.error('post-commit appointment emit failed', err as Error);
    }
  }

  async cancel(id: string, dto: CancelAppointmentDto) {
    const currentUserId = RequestContextService.getUserId()!;

    const cancelableStatuses = ['scheduled', 'confirmed', 'in_progress'];

    const updated = await this.prisma.transaction(async (tx) => {
      const appt = await tx.appointment.findUnique({ where: { id } });
      if (!appt)
        throw new NotFoundException(
          t('appointment.NOT_FOUND', 'Appointment not found'),
        );

      if (!cancelableStatuses.includes(appt.status)) {
        throw new BadRequestException(
          t(
            'appointment.STATUS_BLOCKS_CANCEL',
            `Cannot cancel appointment in status ${appt.status}`,
            { args: { status: appt.status } },
          ),
        );
      }

      const result = await tx.appointment.update({
        where: { id },
        data: {
          status: 'cancelled',
          cancelledBy: currentUserId,
          cancelledAt: new Date(),
          cancellationReason: dto.reason,
        },
      });

      await tx.patientProcedure.updateMany({
        where: { appointmentId: id, deletedAt: null },
        data: { appointmentId: null },
      });

      return result;
    });

    this.gateway.emitAppointmentCancelled({
      id: updated.id,
      providerId: updated.providerId,
    });

    void this.emailProducer.publishCancelled(updated.id, dto.reason);

    return updated;
  }

  async transitionStatus(id: string, dto: TransitionStatusDto) {
    const appt = await this.prisma.baseClient.appointment.findUnique({
      where: { id },
    });
    if (!appt)
      throw new NotFoundException(
        t('appointment.NOT_FOUND', 'Appointment not found'),
      );

    const allowed = STATUS_TRANSITION_MATRIX[appt.status] ?? [];
    if (!allowed.includes(dto.status)) {
      throw new BadRequestException(
        t(
          'appointment.STATUS_TRANSITION_INVALID',
          `Cannot transition appointment from ${appt.status} to ${dto.status}`,
          { args: { from: appt.status, to: dto.status } },
        ),
      );
    }

    const data: {
      status: TransitionableStatus;
      notes?: string;
    } = { status: dto.status };
    if (dto.note?.trim()) {
      const stamped = `[${dto.status}] ${dto.note.trim()}`;
      data.notes = appt.notes ? `${appt.notes}\n${stamped}` : stamped;
    }

    const updated = await this.prisma.baseClient.appointment.update({
      where: { id },
      data,
    });

    this.gateway.emitAppointmentUpdated({
      id: updated.id,
      providerId: updated.providerId,
      startTime: updated.startTime.toISOString(),
      endTime: updated.endTime.toISOString(),
    });

    if (dto.status === 'confirmed') {
      void this.emailProducer.publishConfirmed(updated.id);
    } else if (dto.status === 'completed') {
      void this.emailProducer.publishCompleted(updated.id);
    }

    return this.findById(updated.id);
  }

  async update(id: string, dto: UpdateAppointmentDto) {
    const blockedStatuses = ['cancelled', 'completed', 'no_show'];

    const appt = await this.prisma.baseClient.appointment.findUnique({
      where: { id },
    });
    if (!appt)
      throw new NotFoundException(
        t('appointment.NOT_FOUND', 'Appointment not found'),
      );

    if (blockedStatuses.includes(appt.status)) {
      throw new BadRequestException(
        t(
          'appointment.STATUS_BLOCKS_UPDATE',
          `Cannot update appointment in status ${appt.status}`,
          { args: { status: appt.status } },
        ),
      );
    }

    if (dto.typeId && dto.typeId !== appt.typeId) {
      const type = await this.prisma.baseClient.appointmentType.findUnique({
        where: { id: dto.typeId },
        select: { id: true, isActive: true },
      });
      if (!type) throw new NotFoundException('Appointment type not found');
      if (!type.isActive)
        throw new BadRequestException('Appointment type is inactive');
    }

    const targetProviderId = dto.providerId ?? appt.providerId;
    const existingDurationMs =
      appt.endTime.getTime() - appt.startTime.getTime();
    const targetDurationMs = dto.durationMinutes
      ? dto.durationMinutes * 60_000
      : existingDurationMs;
    const targetStartTime = dto.startTime
      ? new Date(dto.startTime)
      : appt.startTime;
    const targetEndTime = new Date(
      targetStartTime.getTime() + targetDurationMs,
    );

    const timeChanged =
      targetStartTime.getTime() !== appt.startTime.getTime() ||
      targetEndTime.getTime() !== appt.endTime.getTime() ||
      targetProviderId !== appt.providerId;

    if (timeChanged) {
      await this.validateAvailability(
        targetProviderId,
        targetStartTime,
        targetEndTime,
      );
    }

    const data: {
      typeId?: string;
      providerId?: string;
      startTime?: Date;
      endTime?: Date;
      notes?: string | null;
      chiefComplaint?: string | null;
    } = {};
    if (dto.typeId !== undefined) data.typeId = dto.typeId;
    if (dto.providerId !== undefined) data.providerId = dto.providerId;
    if (timeChanged) {
      data.startTime = targetStartTime;
      data.endTime = targetEndTime;
    }
    if (dto.notes !== undefined) data.notes = dto.notes || null;
    if (dto.chiefComplaint !== undefined)
      data.chiefComplaint = dto.chiefComplaint || null;

    let updated: typeof appt;
    try {
      updated = await this.prisma.transaction(async (tx) => {
        const next = await tx.appointment.update({
          where: { id },
          data,
        });

        if (dto.procedureIds !== undefined) {
          const desired = new Set(dto.procedureIds);

          const currentLinked = await tx.patientProcedure.findMany({
            where: { appointmentId: id, deletedAt: null },
            select: { id: true },
          });
          const currentIds = new Set(currentLinked.map((p) => p.id));

          const toUnlink = [...currentIds].filter((pid) => !desired.has(pid));
          const toLink = [...desired].filter((pid) => !currentIds.has(pid));

          if (toLink.length > 0) {
            const procedures = await tx.patientProcedure.findMany({
              where: { id: { in: toLink } },
              select: {
                id: true,
                patientId: true,
                status: true,
                appointmentId: true,
                deletedAt: true,
              },
            });

            const foundIds = new Set(procedures.map((p) => p.id));
            const missingIds = toLink.filter((pid) => !foundIds.has(pid));
            if (missingIds.length > 0) {
              throw new BadRequestException(
                `Procedure(s) not found: ${missingIds.join(', ')}`,
              );
            }

            const invalidIds = procedures
              .filter(
                (p) =>
                  p.patientId !== next.patientId ||
                  p.status !== 'planned' ||
                  p.appointmentId !== null ||
                  p.deletedAt !== null,
              )
              .map((p) => p.id);

            if (invalidIds.length > 0) {
              throw new BadRequestException(
                `Procedure(s) cannot be linked (wrong patient, not planned, already linked, or deleted): ${invalidIds.join(', ')}`,
              );
            }

            await tx.patientProcedure.updateMany({
              where: { id: { in: toLink } },
              data: { appointmentId: id },
            });
          }

          if (toUnlink.length > 0) {
            await tx.patientProcedure.updateMany({
              where: { id: { in: toUnlink } },
              data: { appointmentId: null },
            });
          }
        }

        return next;
      });
    } catch (err) {
      await tryMapConflict(err, {
        db: this.prisma.baseClient,
        providerId: targetProviderId,
        startTime: targetStartTime,
        endTime: targetEndTime,
        excludeId: id,
      });
      throw err;
    }

    this.gateway.emitAppointmentUpdated({
      id: updated.id,
      providerId: updated.providerId,
      startTime: updated.startTime.toISOString(),
      endTime: updated.endTime.toISOString(),
      ...(dto.providerId && dto.providerId !== appt.providerId
        ? { previousProviderId: appt.providerId }
        : {}),
    });

    return this.findById(updated.id);
  }

  async reschedule(id: string, dto: RescheduleAppointmentDto) {
    const blockedStatuses = ['cancelled', 'completed', 'no_show'];

    const appt = await this.prisma.baseClient.appointment.findUnique({
      where: { id },
    });
    if (!appt)
      throw new NotFoundException(
        t('appointment.NOT_FOUND', 'Appointment not found'),
      );

    if (blockedStatuses.includes(appt.status)) {
      throw new BadRequestException(
        t(
          'appointment.STATUS_BLOCKS_RESCHEDULE',
          `Cannot reschedule from status ${appt.status}`,
          { args: { status: appt.status } },
        ),
      );
    }

    const targetProviderId = dto.providerId ?? appt.providerId;
    const existingDurationMs =
      appt.endTime.getTime() - appt.startTime.getTime();
    const durationMs = dto.durationMinutes
      ? dto.durationMinutes * 60_000
      : existingDurationMs;

    const startTime = new Date(dto.startTime);
    const endTime = new Date(startTime.getTime() + durationMs);

    await this.validateAvailability(targetProviderId, startTime, endTime);

    let updated: typeof appt;
    try {
      updated = await this.prisma.transaction(async (tx) => {
        return tx.appointment.update({
          where: { id },
          data: { startTime, endTime, providerId: targetProviderId },
        });
      });
    } catch (err) {
      await tryMapConflict(err, {
        db: this.prisma.baseClient,
        providerId: targetProviderId,
        startTime,
        endTime,
        excludeId: id,
      });
      throw err;
    }

    this.gateway.emitAppointmentUpdated({
      id: updated.id,
      providerId: updated.providerId,
      startTime: updated.startTime.toISOString(),
      endTime: updated.endTime.toISOString(),
      ...(dto.providerId && dto.providerId !== appt.providerId
        ? { previousProviderId: appt.providerId }
        : {}),
    });

    return updated;
  }

  async findAll(query: ListAppointmentsQueryDto) {
    const {
      from,
      to,
      providerIds,
      patientId,
      statuses,
      page = 1,
      limit = 200,
    } = query;

    const where = {
      startTime: { gte: new Date(from), lte: new Date(to) },
      ...(patientId && { patientId }),
      ...(providerIds?.length && { providerId: { in: providerIds } }),
      ...(statuses?.length && { status: { in: statuses } }),
    };

    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.baseClient.appointment.findMany({
        where,
        include: APPOINTMENT_INCLUDE,
        orderBy: { startTime: 'asc' },
        skip,
        take: limit,
      }),
      this.prisma.baseClient.appointment.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async findById(id: string) {
    const appt = await this.prisma.baseClient.appointment.findUnique({
      where: { id },
      include: APPOINTMENT_INCLUDE,
    });

    if (!appt)
      throw new NotFoundException(
        t('appointment.NOT_FOUND', 'Appointment not found'),
      );
    return appt;
  }

  private async validateAvailability(
    providerId: string,
    startTime: Date,
    endTime: Date,
  ): Promise<void> {
    const result = await this.availability.getAvailability(
      providerId,
      startTime.toISOString(),
    );

    if (result.hasApprovedDayOff) {
      throw new ConflictException(
        t('appointment.PROVIDER_OFF', 'Provider is off on this date'),
      );
    }

    if (result.windows.length === 0) {
      throw new ConflictException(
        t(
          'appointment.OUTSIDE_HOURS',
          'Slot is outside provider working hours',
        ),
      );
    }

    const startHHmm = toHHmm(startTime);
    const endHHmm = toHHmm(endTime);

    const covered = result.windows.some(
      (w) =>
        compareHHmm(w.start, startHHmm) <= 0 &&
        compareHHmm(w.end, endHHmm) >= 0,
    );

    if (!covered) {
      throw new ConflictException(
        t(
          'appointment.OUTSIDE_HOURS',
          'Slot is outside provider working hours',
        ),
      );
    }
  }
}
