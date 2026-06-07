export type AuditCategory =
  | 'auth'
  | 'rbac'
  | 'phi'
  | 'ops'
  | 'clinical'
  | 'operations'
  | 'system'
  | 'security';

export type AuditSeverity = 'info' | 'notice' | 'warning' | 'critical';

export interface AuditEventDef {
  category: AuditCategory;
  severity: AuditSeverity;
  reasonRequired?: boolean;
}

export const AUDIT_EVENTS = {
  AUTH_LOGIN_SUCCESS: { category: 'auth', severity: 'info' },
  AUTH_LOGIN_FAILURE: { category: 'auth', severity: 'warning' },
  AUTH_LOGOUT: { category: 'auth', severity: 'info' },
  AUTH_PASSWORD_CHANGED: { category: 'auth', severity: 'notice' },
  AUTH_PASSWORD_RESET_REQUESTED: { category: 'auth', severity: 'info' },
  AUTH_PASSWORD_RESET_COMPLETED: { category: 'auth', severity: 'notice' },
  AUTH_REFRESH_TOKEN_REUSE: { category: 'auth', severity: 'critical' },
  AUTH_ACCESS_DENIED: { category: 'auth', severity: 'warning' },
  AUTH_RATE_LIMITED: { category: 'auth', severity: 'warning' },

  RBAC_ROLE_CREATED: { category: 'rbac', severity: 'notice' },
  RBAC_ROLE_UPDATED: { category: 'rbac', severity: 'notice' },
  RBAC_ROLE_DELETED: { category: 'rbac', severity: 'warning' },
  RBAC_ROLE_PERMISSIONS_ASSIGNED: { category: 'rbac', severity: 'notice' },
  RBAC_ROLE_PERMISSIONS_REVOKED: { category: 'rbac', severity: 'notice' },
  RBAC_ROLE_PERMISSIONS_RESET: { category: 'rbac', severity: 'warning' },
  RBAC_USER_OVERRIDE_GRANTED: { category: 'rbac', severity: 'warning' },
  RBAC_USER_OVERRIDE_REVOKED: { category: 'rbac', severity: 'notice' },

  USER_CREATED: { category: 'ops', severity: 'notice' },
  USER_UPDATED: { category: 'ops', severity: 'notice' },
  USER_STATUS_CHANGED: { category: 'ops', severity: 'notice' },
  USER_BULK_STATUS_CHANGED: { category: 'ops', severity: 'notice' },
  USER_ROLE_SYNCED: { category: 'rbac', severity: 'notice' },
  USER_DELETED: { category: 'ops', severity: 'critical' },

  PROVIDER_CREATED: { category: 'ops', severity: 'notice' },
  PROVIDER_UPDATED: { category: 'ops', severity: 'notice' },
  PROVIDER_BULK_STATUS_CHANGED: { category: 'ops', severity: 'notice' },
  PROVIDER_DELETED: { category: 'ops', severity: 'warning' },
  EMAIL_OUTBOUND_RESENT: { category: 'ops', severity: 'notice' },
  EMAIL_WEBHOOK_RECEIVED: { category: 'ops', severity: 'info' },

  KIOSK_SESSION_CREATED: { category: 'ops', severity: 'info' },
  KIOSK_SESSION_CLOSED: { category: 'ops', severity: 'info' },

  PATIENT_VIEWED: { category: 'phi', severity: 'info' },
  PATIENT_CREATED: { category: 'phi', severity: 'notice' },
  PATIENT_UPDATED: { category: 'phi', severity: 'notice' },
  PATIENT_DELETED: {
    category: 'phi',
    severity: 'critical',
    reasonRequired: true,
  },
  CLINICAL_NOTE_VIEWED: {
    category: 'phi',
    severity: 'info',
    reasonRequired: true,
  },
  CLINICAL_NOTE_LIST_VIEWED: {
    category: 'phi',
    severity: 'info',
    reasonRequired: true,
  },
  CLINICAL_NOTE_CREATED: { category: 'phi', severity: 'notice' },
  CLINICAL_NOTE_UPDATED: { category: 'phi', severity: 'notice' },
  CLINICAL_NOTE_SIGNED: { category: 'phi', severity: 'notice' },
  CLINICAL_NOTE_ADDENDUM_CREATED: { category: 'phi', severity: 'notice' },
  CLINICAL_NOTE_DELETED: { category: 'phi', severity: 'warning' },
  CLINICAL_NOTE_MIGRATED: { category: 'phi', severity: 'notice' },
  CLINICAL_NOTE_RAG_REINDEXED: { category: 'phi', severity: 'info' },
  PATIENT_FILE_DOWNLOADED: {
    category: 'phi',
    severity: 'notice',
    reasonRequired: true,
  },
  PATIENT_FILE_CREATED: { category: 'phi', severity: 'notice' },
  PATIENT_FILE_UPDATED: { category: 'phi', severity: 'info' },
  PATIENT_FILE_DELETED: { category: 'phi', severity: 'warning' },

  APPOINTMENT_CREATED: { category: 'ops', severity: 'info' },
  APPOINTMENT_UPDATED: { category: 'ops', severity: 'info' },
  APPOINTMENT_CANCELLED: { category: 'ops', severity: 'notice' },
  TREATMENT_PLAN_CREATED: { category: 'phi', severity: 'notice' },
  TREATMENT_PLAN_UPDATED: { category: 'phi', severity: 'notice' },
  TREATMENT_PLAN_VIEWED: { category: 'phi', severity: 'info' },
  TREATMENT_PLAN_TRANSITIONED: { category: 'phi', severity: 'notice' },
  TREATMENT_PLAN_CANCELLED: {
    category: 'phi',
    severity: 'notice',
    reasonRequired: true,
  },

  PROCEDURE_CREATED: { category: 'clinical', severity: 'notice' },
  PROCEDURE_UPDATED: { category: 'clinical', severity: 'notice' },
  PROCEDURE_BULK_IMPORTED: { category: 'clinical', severity: 'notice' },
  PROCEDURE_DISABLED: { category: 'clinical', severity: 'notice' },
  PROCEDURE_ENABLED: { category: 'clinical', severity: 'info' },

  APPOINTMENT_TYPE_CREATED: { category: 'clinical', severity: 'notice' },
  APPOINTMENT_TYPE_UPDATED: { category: 'clinical', severity: 'notice' },
  APPOINTMENT_TYPE_DISABLED: { category: 'clinical', severity: 'notice' },
  APPOINTMENT_TYPE_ENABLED: { category: 'clinical', severity: 'info' },

  OPERATORY_CREATED: { category: 'clinical', severity: 'notice' },
  OPERATORY_UPDATED: { category: 'clinical', severity: 'notice' },
  OPERATORY_DISABLED: { category: 'clinical', severity: 'notice' },
  OPERATORY_REORDERED: { category: 'clinical', severity: 'info' },

  PROVIDER_SCHEDULE_CREATED: { category: 'operations', severity: 'info' },
  PROVIDER_SCHEDULE_UPDATED: { category: 'operations', severity: 'info' },
  PROVIDER_SCHEDULE_DELETED: { category: 'operations', severity: 'notice' },
  PROVIDER_SCHEDULE_BULK_REPLACED: {
    category: 'operations',
    severity: 'notice',
  },

  SCHEDULE_OVERRIDE_REQUESTED: { category: 'operations', severity: 'info' },
  SCHEDULE_OVERRIDE_APPROVED: { category: 'operations', severity: 'notice' },
  SCHEDULE_OVERRIDE_REJECTED: {
    category: 'operations',
    severity: 'notice',
    reasonRequired: true,
  },
  SCHEDULE_OVERRIDE_CANCELLED: { category: 'operations', severity: 'info' },

  PATIENT_PROCEDURE_CREATED: { category: 'phi', severity: 'notice' },
  PATIENT_PROCEDURE_UPDATED: { category: 'phi', severity: 'notice' },
  PATIENT_PROCEDURE_TRANSITIONED: { category: 'phi', severity: 'notice' },
  PATIENT_PROCEDURE_LINKED: { category: 'phi', severity: 'info' },
  PATIENT_PROCEDURE_UNLINKED: { category: 'phi', severity: 'info' },
  PATIENT_PROCEDURE_FEE_FINALIZED: { category: 'phi', severity: 'notice' },
  PATIENT_PROCEDURE_FEE_OVERRIDDEN: {
    category: 'phi',
    severity: 'warning',
    reasonRequired: true,
  },
  PATIENT_PROCEDURE_PROMOTED_TO_PLAN: { category: 'phi', severity: 'notice' },
  PATIENT_PROCEDURE_DELETED: { category: 'phi', severity: 'warning' },
  PATIENT_PROCEDURE_VIEWED: { category: 'phi', severity: 'info' },

  FORM_CREATED: { category: 'ops', severity: 'info' },
  FORM_UPDATED: { category: 'ops', severity: 'info' },
  INTERNAL_DOCUMENT_CREATED: { category: 'ops', severity: 'notice' },
  INTERNAL_DOCUMENT_DELETED: { category: 'ops', severity: 'warning' },
  INTERNAL_DOCUMENT_UPDATED: { category: 'ops', severity: 'notice' },
  INTERNAL_DOCUMENT_VIEWED: { category: 'ops', severity: 'info' },
  DOCUMENT_ACCESS_UPDATED: { category: 'ops', severity: 'notice' },
  DOCUMENT_DOWNLOAD_ISSUED: { category: 'ops', severity: 'notice' },
  DOCUMENT_VERSION_ACTIVATED: { category: 'ops', severity: 'info' },
  DOCUMENT_VERSION_UPLOADED: { category: 'ops', severity: 'notice' },
  DOCUMENT_CATEGORY_CREATED: { category: 'ops', severity: 'notice' },
  DOCUMENT_CATEGORY_UPDATED: { category: 'ops', severity: 'notice' },
  DOCUMENT_CATEGORY_DELETED: { category: 'ops', severity: 'warning' },
  INVENTORY_ITEM_CREATED: { category: 'ops', severity: 'info' },
  INVENTORY_ITEM_UPDATED: { category: 'ops', severity: 'info' },
  INVENTORY_TRANSACTION_RECORDED: { category: 'ops', severity: 'info' },

  RAG_DOCUMENT_INGESTED: { category: 'system', severity: 'info' },
  CHAT_SESSION_STARTED: { category: 'ops', severity: 'info' },
  CHAT_SESSION_UPDATED: { category: 'ops', severity: 'notice' },
  CHAT_SESSION_SCOPE_CHANGED: { category: 'ops', severity: 'notice' },

  AI_PROVIDER_CREATED: { category: 'system', severity: 'notice' },
  AI_PROVIDER_UPDATED: { category: 'system', severity: 'notice' },
  AI_PROVIDER_DELETED: { category: 'system', severity: 'warning' },
  AI_MODEL_CREATED: { category: 'system', severity: 'notice' },
  AI_MODEL_UPDATED: { category: 'system', severity: 'notice' },
  AI_MODEL_DELETED: { category: 'system', severity: 'warning' },

  PHI_ACCESS_ERROR: { category: 'phi', severity: 'warning' },
  SECURITY_ANOMALY_DETECTED: {
    category: 'security',
    severity: 'critical',
    reasonRequired: true,
  },
  DATA_EXPORTED: {
    category: 'security',
    severity: 'warning',
    reasonRequired: true,
  },
} as const satisfies Record<string, AuditEventDef>;

export type AuditEventCode = keyof typeof AUDIT_EVENTS;
