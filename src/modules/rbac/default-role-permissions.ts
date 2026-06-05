import { SYSTEM_ROLE_CODE } from '../../common/constants';

/**  Single source of truth for the permission set each system role receives.
 *  Used by both the seed script (initial install) and the
 *  "reset role permissions" endpoint (runtime reset to defaults).
 *
 *  Values are permission keys in `resource:action` or `resource:action:scope`
 *  form — resolved to permission IDs by the caller.
 *
 *  ADMIN is intentionally absent: it resets dynamically to "every permission
 *  currently in the `permissions` table" so that newly seeded permissions
 *  always flow to Admin without having to update this list.
 */

export const CLINICAL_NOTES_PERMISSIONS = [
  'clinical_notes:create',
  'clinical_notes:read',
  'clinical_notes:read:full',
  'clinical_notes:update',
  'clinical_notes:sign',
  'clinical_notes:addendum',
  'clinical_notes:delete',
] as const;

export function perm(resource: string, action: string): string {
  return `${resource}:${action}`;
}

export function scopedPerm(
  resource: string,
  action: string,
  scope: string,
): string {
  return `${resource}:${action}:${scope}`;
}

function allActions(resource: string): string[] {
  return ['create', 'read', 'update', 'delete'].map((a) => perm(resource, a));
}

export const DEFAULT_ROLE_PERMISSIONS: Record<string, string[]> = {
  [SYSTEM_ROLE_CODE.DOCTOR]: [
    perm('appointments', 'create'),
    perm('appointments', 'read'),
    perm('appointments', 'update'),
    perm('procedures', 'read'),
    perm('appointment_types', 'read'),
    perm('patients', 'read'),
    perm('clinical_notes', 'create'),
    perm('clinical_notes', 'read'),
    scopedPerm('clinical_notes', 'read', 'full'),
    perm('clinical_notes', 'update'),
    perm('clinical_notes', 'sign'),
    perm('clinical_notes', 'addendum'),
    perm('clinical_notes', 'delete'),
    perm('patient_files', 'create'),
    perm('patient_files', 'read'),
    perm('treatment_plans', 'create'),
    perm('treatment_plans', 'read'),
    scopedPerm('treatment_plans', 'read', 'full'),
    perm('treatment_plans', 'update'),
    perm('treatment_plans', 'cancel'),
    perm('patient_procedures', 'create'),
    perm('patient_procedures', 'read'),
    scopedPerm('patient_procedures', 'read', 'full'),
    perm('patient_procedures', 'update'),
    perm('patient_procedures', 'cancel'),
    perm('patient_procedures', 'complete'),
    perm('patient_procedures', 'finalize_fee'),
    perm('patient_procedures', 'promote_to_plan'),
    perm('schedule_overrides', 'create'),
    perm('schedule_overrides', 'read'),
    perm('schedule_overrides', 'cancel'),
    perm('provider_schedules', 'read'),
    perm('internal_documents', 'read'),
    perm('chat_sessions', 'create'),
    perm('chat_sessions', 'read'),
    perm('chat_sessions', 'delete'),
    perm('chat', 'use'),
    perm('rag_patient_notes', 'read'),
    perm('rag_internal_docs', 'read'),
    perm('audit_logs', 'read'),
  ],

  [SYSTEM_ROLE_CODE.RECEPTIONIST]: [
    ...allActions('appointments'),
    perm('patients', 'create'),
    perm('patients', 'read'),
    perm('patients', 'update'),
    perm('patient_files', 'create'),
    perm('patient_files', 'read'),
    perm('patient_files', 'delete'),
    perm('procedures', 'read'),
    perm('appointment_types', 'read'),
    perm('clinical_notes', 'read'),
    perm('treatment_plans', 'read'),
    scopedPerm('treatment_plans', 'read', 'metadata'),
    perm('patient_procedures', 'read'),
    perm('provider_schedules', 'read'),
    perm('schedule_overrides', 'read'),
    perm('internal_documents', 'read'),
    perm('chat_sessions', 'create'),
    perm('chat_sessions', 'read'),
    perm('chat_sessions', 'delete'),
    perm('chat', 'use'),
    perm('rag_internal_docs', 'read'),
    perm('audit_logs', 'read'),
  ],

  [SYSTEM_ROLE_CODE.MANAGER]: [
    scopedPerm('users', 'read', 'non_admin'),
    perm('appointments', 'create'),
    perm('appointments', 'read'),
    perm('patients', 'read'),
    ...allActions('appointment_types'),
    ...allActions('internal_documents'),
    ...allActions('inventory_items'),
    perm('treatment_plans', 'create'),
    perm('treatment_plans', 'read'),
    scopedPerm('treatment_plans', 'read', 'full'),
    perm('treatment_plans', 'update'),
    perm('treatment_plans', 'cancel'),
    perm('patient_procedures', 'create'),
    perm('patient_procedures', 'read'),
    scopedPerm('patient_procedures', 'read', 'full'),
    perm('patient_procedures', 'finalize_fee'),
    perm('patient_procedures', 'promote_to_plan'),
    perm('schedule_overrides', 'create'),
    perm('schedule_overrides', 'read'),
    perm('schedule_overrides', 'update'),
    perm('schedule_overrides', 'review'),
    perm('schedule_overrides', 'cancel'),
    perm('provider_schedules', 'create'),
    perm('provider_schedules', 'read'),
    perm('provider_schedules', 'update'),
    perm('provider_schedules', 'delete'),
    perm('procedures', 'create'),
    perm('procedures', 'update'),
    perm('chat_sessions', 'create'),
    perm('chat_sessions', 'read'),
    perm('chat_sessions', 'delete'),
    perm('chat', 'use'),
    perm('rag_internal_docs', 'read'),
    perm('email_logs', 'read'),
    perm('financial_reports', 'read'),
    perm('audit_logs', 'read'),
    scopedPerm('audit_logs', 'read', 'operations'),
  ],
};

// Role codes that support "reset to system defaults". ADMIN is included —
// its default is resolved dynamically to all currently-known permissions.
export const RESETTABLE_ROLE_CODES: readonly string[] = [
  SYSTEM_ROLE_CODE.ADMIN,
  SYSTEM_ROLE_CODE.DOCTOR,
  SYSTEM_ROLE_CODE.RECEPTIONIST,
  SYSTEM_ROLE_CODE.MANAGER,
];
