import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import 'dotenv/config';

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});

const prisma = new PrismaClient({ adapter });

function parseArgs(): { dryRun: boolean; limit: number | null; appointmentId: string | null } {
  const args = process.argv.slice(2);
  let dryRun = false;
  let limit: number | null = null;
  let appointmentId: string | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dry-run') {
      dryRun = true;
    } else if (args[i] === '--limit' && args[i + 1]) {
      limit = parseInt(args[++i], 10);
    } else if (args[i] === '--appointment-id' && args[i + 1]) {
      appointmentId = args[++i];
    }
  }

  return { dryRun, limit, appointmentId };
}

type ProcedureRow = {
  id: string;
  patientId: string;
  appointmentId: string | null;
  performedByProviderId: string | null;
  toothNumber: string | null;
  clinicalNotes: string;
  updatedAt: Date;
  adaCode: string;
};

async function getAlreadyMigratedProcedureIds(): Promise<Set<string>> {
  const events = await prisma.auditLog.findMany({
    where: { eventCode: 'CLINICAL_NOTE_MIGRATED' },
    select: { metadata: true },
  });

  const migratedIds = new Set<string>();
  for (const event of events) {
    const meta = event.metadata as Record<string, unknown> | null;
    if (meta && Array.isArray(meta['sourceProcedureIds'])) {
      for (const id of meta['sourceProcedureIds'] as string[]) {
        migratedIds.add(id);
      }
    }
  }

  return migratedIds;
}

async function fetchProceduresForAppointment(apptId: string): Promise<ProcedureRow[]> {
  const rows = await prisma.patientProcedure.findMany({
    where: { appointmentId: apptId, deletedAt: null },
    select: {
      id: true,
      patientId: true,
      appointmentId: true,
      performedByProviderId: true,
      toothNumber: true,
      clinicalNotes: true,
      updatedAt: true,
      procedure: { select: { adaCode: true } },
    },
  });

  return rows
    .filter((r) => r.clinicalNotes && r.clinicalNotes.trim() !== '')
    .map((r) => ({
      id: r.id,
      patientId: r.patientId,
      appointmentId: r.appointmentId,
      performedByProviderId: r.performedByProviderId,
      toothNumber: r.toothNumber,
      clinicalNotes: r.clinicalNotes!,
      updatedAt: r.updatedAt,
      adaCode: r.procedure.adaCode,
    }));
}

async function fetchStandaloneProcedures(): Promise<ProcedureRow[]> {
  const rows = await prisma.patientProcedure.findMany({
    where: { appointmentId: null, deletedAt: null },
    select: {
      id: true,
      patientId: true,
      appointmentId: true,
      performedByProviderId: true,
      toothNumber: true,
      clinicalNotes: true,
      updatedAt: true,
      procedure: { select: { adaCode: true } },
    },
  });

  return rows
    .filter((r) => r.clinicalNotes && r.clinicalNotes.trim() !== '')
    .map((r) => ({
      id: r.id,
      patientId: r.patientId,
      appointmentId: r.appointmentId,
      performedByProviderId: r.performedByProviderId,
      toothNumber: r.toothNumber,
      clinicalNotes: r.clinicalNotes!,
      updatedAt: r.updatedAt,
      adaCode: r.procedure.adaCode,
    }));
}

async function fetchDistinctAppointmentIds(filterAppointmentId: string | null): Promise<string[]> {
  if (filterAppointmentId !== null) {
    return [filterAppointmentId];
  }

  const rows = await prisma.$queryRaw<Array<{ appointment_id: string }>>`
    SELECT DISTINCT appointment_id
    FROM patient_procedures
    WHERE clinical_notes IS NOT NULL
      AND clinical_notes <> ''
      AND deleted_at IS NULL
      AND appointment_id IS NOT NULL
  `;

  return rows.map((r) => r.appointment_id);
}

function buildPlanText(procedures: ProcedureRow[]): string {
  return procedures
    .map((p) => `[ADA ${p.adaCode} tooth ${p.toothNumber ?? '-'}] ${p.clinicalNotes}`)
    .join('\n\n');
}

async function migrateAppointmentGroup(apptId: string, procedures: ProcedureRow[]): Promise<void> {
  const appointment = await prisma.appointment.findFirst({
    where: { id: apptId },
    select: { patientId: true, providerId: true, completedAt: true, updatedAt: true },
  });

  if (!appointment) {
    console.warn(`[SKIP] Appointment ${apptId} not found`);
    return;
  }

  const provider = await prisma.provider.findFirst({
    where: { id: appointment.providerId },
    select: { userId: true },
  });

  if (!provider) {
    console.warn(`[SKIP] Provider ${appointment.providerId} not found — manual fix required`);
    return;
  }

  const signedAt = appointment.completedAt ?? appointment.updatedAt;
  const planText = buildPlanText(procedures);
  const sourceProcedureIds = procedures.map((p) => p.id);

  if (planText.length > 8000) {
    console.warn(`[WARN] Appointment ${apptId} plan text length=${planText.length} exceeds 8000 chars`);
  }

  await prisma.$transaction(async (tx) => {
    const note = await tx.clinicalNote.create({
      data: {
        patientId: appointment.patientId,
        providerId: appointment.providerId,
        appointmentId: apptId,
        plan: planText,
        status: 'signed',
        signedAt,
        signedBy: provider.userId,
        createdBy: provider.userId,
        createdAt: signedAt,
      },
    });

    await tx.auditLog.create({
      data: {
        id: randomUUID(),
        eventCode: 'CLINICAL_NOTE_MIGRATED',
        eventVersion: 1,
        category: 'phi',
        severity: 'notice',
        outcome: 'success',
        actorType: 'system',
        resource: 'clinical_note',
        resourceId: note.id,
        metadata: {
          sourceProcedureIds,
          source: 'patient_procedure_migration',
        },
        source: 'script',
        createdAt: new Date(),
      },
    });
  });
}

async function migrateStandaloneProcedure(procedure: ProcedureRow): Promise<void> {
  if (!procedure.performedByProviderId) {
    console.warn(`[SKIP] Procedure ${procedure.id} has no performedByProviderId`);
    return;
  }

  const provider = await prisma.provider.findFirst({
    where: { id: procedure.performedByProviderId },
    select: { userId: true },
  });

  if (!provider) {
    console.warn(`[SKIP] Provider ${procedure.performedByProviderId} for procedure ${procedure.id} not found`);
    return;
  }

  const signedAt = procedure.updatedAt;
  const planText = buildPlanText([procedure]);

  await prisma.$transaction(async (tx) => {
    const note = await tx.clinicalNote.create({
      data: {
        patientId: procedure.patientId,
        providerId: procedure.performedByProviderId!,
        appointmentId: null,
        plan: planText,
        status: 'signed',
        signedAt,
        signedBy: provider.userId,
        createdBy: provider.userId,
        createdAt: signedAt,
      },
    });

    await tx.auditLog.create({
      data: {
        id: randomUUID(),
        eventCode: 'CLINICAL_NOTE_MIGRATED',
        eventVersion: 1,
        category: 'phi',
        severity: 'notice',
        outcome: 'success',
        actorType: 'system',
        resource: 'clinical_note',
        resourceId: note.id,
        metadata: {
          sourceProcedureIds: [procedure.id],
          source: 'patient_procedure_migration',
        },
        source: 'script',
        createdAt: new Date(),
      },
    });
  });
}

async function main(): Promise<void> {
  const { dryRun, limit, appointmentId: filterAppointmentId } = parseArgs();

  console.log(
    `[migrate-procedure-notes] dryRun=${dryRun} limit=${limit ?? 'none'} appointmentId=${filterAppointmentId ?? 'all'}`,
  );

  const migratedIds = await getAlreadyMigratedProcedureIds();
  console.log(
    `[migrate-procedure-notes] Found ${migratedIds.size} already-migrated procedure IDs in audit log`,
  );

  let appointmentIds = await fetchDistinctAppointmentIds(filterAppointmentId);
  const standaloneProcedures = filterAppointmentId ? [] : await fetchStandaloneProcedures();

  console.log(
    `[migrate-procedure-notes] Appointment groups: ${appointmentIds.length}, standalone procedures: ${standaloneProcedures.length}`,
  );

  if (dryRun) {
    const totalGroups = appointmentIds.length + standaloneProcedures.length;
    console.log(`[DRY-RUN] Total groups to process: ${totalGroups}`);

    let sampleCount = 0;
    for (const apptId of appointmentIds) {
      if (sampleCount >= 10) break;
      const procedures = await fetchProceduresForAppointment(apptId);
      const unmigrated = procedures.filter((p) => !migratedIds.has(p.id));
      if (unmigrated.length === 0) continue;
      console.log(
        `[DRY-RUN] Appointment ${apptId}: ${unmigrated.length} procedure(s), plan preview: ${buildPlanText(unmigrated).slice(0, 120)}...`,
      );
      sampleCount++;
    }

    for (const proc of standaloneProcedures) {
      if (sampleCount >= 10) break;
      if (migratedIds.has(proc.id)) continue;
      console.log(
        `[DRY-RUN] Standalone procedure ${proc.id}: plan preview: ${buildPlanText([proc]).slice(0, 120)}...`,
      );
      sampleCount++;
    }

    return;
  }

  if (limit !== null) {
    appointmentIds = appointmentIds.slice(0, limit);
  }

  let processed = 0;
  let skipped = 0;

  for (const apptId of appointmentIds) {
    const procedures = await fetchProceduresForAppointment(apptId);
    const unmigrated = procedures.filter((p) => !migratedIds.has(p.id));

    if (unmigrated.length === 0) {
      skipped++;
      continue;
    }

    await migrateAppointmentGroup(apptId, unmigrated);
    processed++;

    if (processed % 100 === 0) {
      console.log(
        `[migrate-procedure-notes] Progress: ${processed} groups processed, ${skipped} skipped`,
      );
    }
  }

  const standaloneToProcess =
    limit !== null
      ? standaloneProcedures.slice(0, Math.max(0, limit - appointmentIds.length))
      : standaloneProcedures;

  for (const proc of standaloneToProcess) {
    if (migratedIds.has(proc.id)) {
      skipped++;
      continue;
    }

    await migrateStandaloneProcedure(proc);
    processed++;

    if (processed % 100 === 0) {
      console.log(
        `[migrate-procedure-notes] Progress: ${processed} total processed, ${skipped} skipped`,
      );
    }
  }

  console.log(`[migrate-procedure-notes] Done. processed=${processed} skipped=${skipped}`);
}

main()
  .catch((err) => {
    console.error('[migrate-procedure-notes] Fatal error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
