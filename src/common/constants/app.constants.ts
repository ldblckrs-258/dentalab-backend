// Metadata keys for decorators
export const SKIP_RESPONSE_WRAP_KEY = 'skip_response_wrap';
export const RATE_LIMIT_KEY = 'rate_limit';

// Pagination
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

// Timezone
export const DEFAULT_TIMEZONE = 'Asia/Ho_Chi_Minh';

// Rate limiting
export const DEFAULT_RATE_LIMIT_WINDOW = 60;
export const DEFAULT_RATE_LIMIT_MAX = 200;
export const SUPPORTED_LANGUAGES = ['vi', 'en'] as const;
export const DEFAULT_LANGUAGE = 'vi';

// Soft-deletable models — operational flag (is_active)
export const SOFT_DELETE_MODELS = [
  'User',
  'Provider',
  'Procedure',
  'AppointmentType',
  'UserPermissionOverride',
];

// Soft-deletable models — permanent logical deletion (deleted_at)
export const SOFT_DELETE_AT_MODELS = [
  'Patient',
  'ClinicalNote',
  'PatientFile',
  'InternalDocument',
  'PatientProcedure',
];
