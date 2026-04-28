export const EMAIL_PROVIDER = 'EMAIL_PROVIDER';

// System template names — must match MJML files in `./templates/<name>.<lang>.mjml`
export const SYSTEM_TEMPLATES = {
  PASSWORD_RESET: 'password-reset',
  WELCOME: 'welcome',
  REMINDER: 'appointment-reminder',
} as const;

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
