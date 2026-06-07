// Metadata keys for decorators
export const SKIP_RESPONSE_WRAP_KEY = 'skip_response_wrap';
export const RATE_LIMIT_KEY = 'rate_limit';

// Pagination
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

// Timezone
export const DEFAULT_TIMEZONE = 'Asia/Ho_Chi_Minh';

// Appointment statuses that release a time slot — an appointment in one of
// these states no longer occupies its provider/operatory. Must mirror the
// `appointments_*_no_overlap` gist exclusion predicates exactly.
export const NON_CONFLICTING_APPOINTMENT_STATUSES = ['cancelled', 'no_show'];

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
  'Operatory',
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
