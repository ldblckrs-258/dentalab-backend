export const EMAIL_PROVIDER = 'EMAIL_PROVIDER';

// System template names — must match seed data
export const SYSTEM_TEMPLATES = {
  PASSWORD_RESET: 'password-reset',
  WELCOME: 'welcome',
  REMINDER: 'appointment-reminder',
} as const;

// Email template type enum — must match ERD
export const EMAIL_TEMPLATE_TYPES = [
  'password_reset',
  'appointment_confirmation',
  'appointment_reminder',
  'appointment_cancellation',
  'kiosk_invitation',
  'clinic_notice',
  'system_alert',
] as const;

export type EmailTemplateType = (typeof EMAIL_TEMPLATE_TYPES)[number];

export const EMAIL_STATUS = {
  PENDING: 'pending',
  SENT: 'sent',
  DELIVERED: 'delivered',
  BOUNCED: 'bounced',
  COMPLAINED: 'complained',
  FAILED: 'failed',
} as const;

export type EmailStatus = (typeof EMAIL_STATUS)[keyof typeof EMAIL_STATUS];

export const EMAIL_STATUSES = Object.values(EMAIL_STATUS);

export const WEBHOOK_EVENT_TYPE = {
  SENT: 'email.sent',
  DELIVERED: 'email.delivered',
  BOUNCED: 'email.bounced',
  COMPLAINED: 'email.complained',
} as const;
