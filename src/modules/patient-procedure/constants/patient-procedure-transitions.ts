export type PatientProcedureStatus =
  | 'planned'
  | 'scheduled'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'failed';

// Single source of truth for allowed PatientProcedure state transitions.
// Used by PatientProcedureService.transition() (Phase 1-revised).
export const ALLOWED_PROCEDURE_TRANSITIONS: Record<
  PatientProcedureStatus,
  PatientProcedureStatus[]
> = {
  planned: ['scheduled', 'cancelled'],
  scheduled: ['planned', 'in_progress', 'cancelled'],
  in_progress: ['completed', 'failed'],
  completed: [],
  cancelled: [],
  failed: [],
};

// Terminal states — no further transitions allowed
export const TERMINAL_PROCEDURE_STATUSES: PatientProcedureStatus[] = [
  'completed',
  'cancelled',
  'failed',
];

// States in which a PatientProcedure can be soft-deleted (spec R14)
export const DELETABLE_PROCEDURE_STATUSES: PatientProcedureStatus[] = [
  'planned',
  'scheduled',
  'cancelled',
];

// States that count as "done" for TreatmentPlan completion guard
export const RESOLVED_PROCEDURE_STATUSES: PatientProcedureStatus[] = [
  'completed',
  'failed',
  'cancelled',
];

// Transitions that require a cancellationReason to be provided
export const REASON_REQUIRED_STATUSES: PatientProcedureStatus[] = [
  'cancelled',
  'failed',
];
