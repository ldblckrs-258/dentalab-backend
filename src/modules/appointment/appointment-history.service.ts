import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@modules/database';
import { RequestContextService } from '@modules/common/context/request-context';
import { t } from '@common/utils';
import type {
  AppointmentChange,
  AppointmentHistoryEntry,
  EntityLabelMaps,
  RecordHistoryInput,
} from './appointment-history.types';

@Injectable()
export class AppointmentHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  async record(
    tx: Prisma.TransactionClient,
    input: RecordHistoryInput,
  ): Promise<void> {
    const ctx = RequestContextService.getCurrentContext();
    await tx.appointmentHistory.create({
      data: {
        appointmentId: input.appointmentId,
        action: input.action,
        changes: input.changes as unknown as Prisma.InputJsonValue,
        reason: input.reason ?? null,
        source: input.source ?? 'staff',
        actorId: ctx?.userId ?? null,
      },
    });
  }

  /**
   * Resolve human labels for the given entity ids. Runs on baseClient (no
   * soft-delete filter) so a since-deactivated provider/procedure still yields
   * its name — history must stay historically accurate. Call BEFORE opening the
   * mutation transaction to keep the tx body thin.
   */
  async resolveLabels(input: {
    providerIds?: (string | null | undefined)[];
    operatoryIds?: (string | null | undefined)[];
    typeIds?: (string | null | undefined)[];
    procedureIds?: (string | null | undefined)[];
  }): Promise<EntityLabelMaps> {
    const clean = (ids?: (string | null | undefined)[]) => [
      ...new Set((ids ?? []).filter((v): v is string => !!v)),
    ];

    const providerIds = clean(input.providerIds);
    const operatoryIds = clean(input.operatoryIds);
    const typeIds = clean(input.typeIds);
    const procedureIds = clean(input.procedureIds);

    const db = this.prisma.baseClient;
    const providers = new Map<string, string>();
    const operatories = new Map<string, string>();
    const types = new Map<string, string>();
    const procedures = new Map<string, string>();

    await Promise.all([
      providerIds.length &&
        db.provider
          .findMany({
            where: { id: { in: providerIds } },
            select: { id: true, user: { select: { fullName: true } } },
          })
          .then((rows) =>
            rows.forEach((r) => providers.set(r.id, r.user.fullName)),
          ),
      operatoryIds.length &&
        db.operatory
          .findMany({
            where: { id: { in: operatoryIds } },
            select: { id: true, name: true },
          })
          .then((rows) => rows.forEach((r) => operatories.set(r.id, r.name))),
      typeIds.length &&
        db.appointmentType
          .findMany({
            where: { id: { in: typeIds } },
            select: { id: true, name: true },
          })
          .then((rows) => rows.forEach((r) => types.set(r.id, r.name))),
      procedureIds.length &&
        db.patientProcedure
          .findMany({
            where: { id: { in: procedureIds } },
            select: { id: true, procedure: { select: { adaCode: true } } },
          })
          .then((rows) =>
            rows.forEach((r) => procedures.set(r.id, r.procedure.adaCode)),
          ),
    ]);

    return { providers, operatories, types, procedures };
  }

  async list(appointmentId: string): Promise<AppointmentHistoryEntry[]> {
    const exists = await this.prisma.baseClient.appointment.findUnique({
      where: { id: appointmentId },
      select: { id: true },
    });
    if (!exists)
      throw new NotFoundException(
        t('appointment.NOT_FOUND', 'Appointment not found'),
      );

    const rows = await this.prisma.baseClient.appointmentHistory.findMany({
      where: { appointmentId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: { actor: { select: { id: true, fullName: true } } },
    });

    return rows.map((r) => ({
      id: r.id,
      action: r.action,
      changes: (r.changes as unknown as AppointmentChange[]) ?? [],
      reason: r.reason,
      source: r.source,
      actor: this.resolveActor(r),
      createdAt: r.createdAt,
    }));
  }

  private resolveActor(r: {
    actorId: string | null;
    source: string;
    actor: { id: string; fullName: string } | null;
  }): { id: string | null; name: string } | null {
    if (r.actor) return { id: r.actor.id, name: r.actor.fullName };
    if (r.source === 'patient_portal') return { id: null, name: 'patient' };
    if (r.actorId) return { id: r.actorId, name: 'deleted_user' };
    return null;
  }
}
