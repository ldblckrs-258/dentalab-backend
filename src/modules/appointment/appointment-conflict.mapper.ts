import { ConflictException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { t } from '@common/utils';

const OVERLAP_CONSTRAINT = 'appointments_no_overlap';
const PG_EXCLUSION_VIOLATION = '23P01';

function isOverlapError(err: unknown): boolean {
  if (err === null || typeof err !== 'object') return false;
  const e = err as Record<string, unknown>;
  const meta = e['meta'] as Record<string, unknown> | undefined;
  if (meta?.['constraint'] === OVERLAP_CONSTRAINT) return true;
  const msg: string = typeof e['message'] === 'string' ? e['message'] : '';
  if (msg.includes(OVERLAP_CONSTRAINT)) return true;
  const raw = e['cause'] as Record<string, unknown> | undefined;
  if ((raw?.['code'] as string) === PG_EXCLUSION_VIOLATION) return true;
  if ((raw?.['message'] as string | undefined)?.includes(OVERLAP_CONSTRAINT))
    return true;
  return false;
}

export async function tryMapConflict(
  err: unknown,
  context: {
    db: Pick<PrismaClient, 'appointment'>;
    providerId: string;
    startTime: Date;
    endTime: Date;
    excludeId?: string;
  },
): Promise<never> {
  if (!isOverlapError(err)) throw err;

  const conflicting = await context.db.appointment.findMany({
    where: {
      providerId: context.providerId,
      status: { not: 'cancelled' },
      ...(context.excludeId && { id: { not: context.excludeId } }),
      startTime: { lt: context.endTime },
      endTime: { gt: context.startTime },
    },
    select: { id: true },
    take: 5,
  });

  throw new ConflictException({
    code: 'APPOINTMENT_OVERLAP',
    message: t(
      'appointment.SLOT_CONFLICT',
      'Slot conflicts with an existing appointment',
    ),
    conflictingAppointmentIds: conflicting.map((a) => a.id),
  });
}
