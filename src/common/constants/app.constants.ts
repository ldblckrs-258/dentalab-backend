// Metadata keys for decorators
export const SKIP_RESPONSE_WRAP_KEY = 'skip_response_wrap';
export const AUDITED_KEY = 'audited_resource';
export const RATE_LIMIT_KEY = 'rate_limit';

// Pagination
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

// Timezone
export const DEFAULT_TIMEZONE = 'Asia/Ho_Chi_Minh';

// Rate limiting
export const DEFAULT_RATE_LIMIT_WINDOW = 60; // 1 minute
export const DEFAULT_RATE_LIMIT_MAX = 100;

// Sensitive fields to redact in audit logs
export const SENSITIVE_FIELDS = [
  'password_hash',
  'token_hash',
  'ssn',
  'credit_card',
  'password',
  'secret',
  'refresh_token',
  'access_token',
];

// i18n
export const SUPPORTED_LANGUAGES = ['vi', 'en'] as const;
export const DEFAULT_LANGUAGE = 'vi';

// Soft-deletable models
export const SOFT_DELETE_MODELS = [
  'User',
  'Patient',
  'Provider',
  'Procedure',
  'AppointmentType',
  'InventoryItem',
  'EmailTemplate',
];
