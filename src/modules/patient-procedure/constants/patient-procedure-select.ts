export const PATIENT_PROCEDURE_SELECT = {
  id: true,
  patientId: true,
  procedureId: true,
  treatmentPlanId: true,
  appointmentId: true,
  plannedProviderId: true,
  toothNumber: true,
  surface: true,
  status: true,
  estimatedFee: true,
  actualFee: true,
  feeFinalizedAt: true,
  scheduledAt: true,
  plannedAt: true,
  createdAt: true,
  updatedAt: true,
  patient: {
    select: { id: true, firstName: true, lastName: true },
  },
  procedure: {
    select: { id: true, adaCode: true, name: true, category: true },
  },
  plannedProvider: {
    select: {
      id: true,
      user: { select: { id: true, fullName: true } },
    },
  },
} as const;

export const PATIENT_PROCEDURE_DETAIL_SELECT = {
  ...PATIENT_PROCEDURE_SELECT,
  performedByProviderId: true,
  diagnosis: true,
  clinicalNotes: true,
  startedAt: true,
  completedAt: true,
  cancelledAt: true,
  cancellationReason: true,
  sequenceInPlan: true,
  createdBy: true,
} as const;

export const PATIENT_PROCEDURE_METADATA_SELECT = {
  id: true,
  patientId: true,
  procedureId: true,
  treatmentPlanId: true,
  appointmentId: true,
  toothNumber: true,
  status: true,
  scheduledAt: true,
  createdAt: true,
  patient: { select: { id: true, firstName: true, lastName: true } },
  procedure: { select: { id: true, name: true } },
} as const;
