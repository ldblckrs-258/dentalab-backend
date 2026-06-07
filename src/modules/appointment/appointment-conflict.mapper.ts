import { ConflictException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { t } from '@common/utils';
import { NON_CONFLICTING_APPOINTMENT_STATUSES } from '@common/constants/app.constants';

const PROVIDER_OVERLAP_CONSTRAINT = 'appointments_no_overlap';
const OPERATORY_OVERLAP_CONSTRAINT = 'appointments_operatory_no_overlap';
const ACTIVE_STATUS = { notIn: NON_CONFLICTING_APPOINTMENT_STATUSES };

function constraintText(err: unknown): string {
  if (err === null || typeof err !== 'object') return '';
  const e = err as Record<string, unknown>;
  const meta = e['meta'] as Record<string, unknown> | undefined;
  const metaConstraint =
    typeof meta?.['constraint'] === 'string' ? meta['constraint'] : '';
  const msg = typeof e['message'] === 'string' ? e['message'] : '';
  const raw = e['cause'] as Record<string, unknown> | undefined;
  const rawMsg = typeof raw?.['message'] === 'string' ? raw['message'] : '';
  return `${metaConstraint}\n${msg}\n${rawMsg}`;
}

export function isOperatoryConstraint(err: unknown): boolean {
  return constraintText(err).includes(OPERATORY_OVERLAP_CONSTRAINT);
}

export function isProviderConstraint(err: unknown): boolean {
  return constraintText(err).includes(PROVIDER_OVERLAP_CONSTRAINT);
}

export async function tryMapConflict(
  err: unknown,
  context: {
    db: Pick<PrismaClient, 'appointment'>;
    providerId: string;
    startTime: Date;
    endTime: Date;
    operatoryId?: string | null;
    excludeId?: string;
  },
): Promise<never> {
  // Operatory constraint is checked first: its name is more specific and a
  // single insert can only violate one exclusion at a time.
  if (isOperatoryConstraint(err)) {
    const conflicting = context.operatoryId
      ? await context.db.appointment.findMany({
          where: {
            operatoryId: context.operatoryId,
            status: ACTIVE_STATUS,
            ...(context.excludeId && { id: { not: context.excludeId } }),
            startTime: { lt: context.endTime },
            endTime: { gt: context.startTime },
          },
          select: { id: true },
          take: 5,
        })
      : [];

    throw new ConflictException({
      code: 'OPERATORY_OVERLAP',
      message: t(
        'appointment.OPERATORY_CONFLICT',
        'Selected operatory is already booked for this time',
      ),
      conflictingAppointmentIds: conflicting.map((a) => a.id),
    });
  }

  if (isProviderConstraint(err)) {
    const conflicting = await context.db.appointment.findMany({
      where: {
        providerId: context.providerId,
        status: ACTIVE_STATUS,
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

  throw err;
}
