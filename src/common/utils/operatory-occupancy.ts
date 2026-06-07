import type { Prisma } from '@prisma/client';
import { NON_CONFLICTING_APPOINTMENT_STATUSES } from '@common/constants/app.constants';

// Single source of truth for "appointments occupying an operatory in [start, end)".
// Must mirror the `appointments_operatory_no_overlap` gist exclusion predicate.
export function operatoryOccupancyWhere(
  start: Date,
  end: Date,
  excludeAppointmentId?: string,
): Prisma.AppointmentWhereInput {
  return {
    operatoryId: { not: null },
    status: { notIn: NON_CONFLICTING_APPOINTMENT_STATUSES },
    startTime: { lt: end },
    endTime: { gt: start },
    ...(excludeAppointmentId ? { id: { not: excludeAppointmentId } } : {}),
  };
}
