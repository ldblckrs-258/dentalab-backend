// Metadata keys
export const IS_PUBLIC_KEY = 'isPublic';
export const PERMISSIONS_KEY = 'permissions';
export const ANY_PERMISSION_KEY = 'anyPermission';

// Cache domains
export const CACHE_DOMAIN_AUTH = 'auth';
export const CACHE_DOMAIN_RBAC = 'rbac';

// Cache TTLs
export const PERMISSION_CACHE_TTL = 300; // 5 minutes

// Cache key prefixes
export const CACHE_KEY_BLACKLIST = 'blacklist';
export const CACHE_KEY_LOGIN_ATTEMPTS = 'login_attempts';

// Token
export const REFRESH_TOKEN_BYTES = 32;
export const REFRESH_TOKEN_COOKIE = 'refresh_token';

// Password
export const BCRYPT_ROUNDS = 10;
export const PASSWORD_MIN_LENGTH = 8;

// Ownership
export const OWNERSHIP_KEY = 'ownership';

// System roles
export const SYSTEM_ROLE_ADMIN = 'Admin';

// Kiosk session statuses
export const KIOSK_STATUS_ACTIVE = 'active';
export const KIOSK_STATUS_COMPLETED = 'completed';
export const KIOSK_STATUS_EXPIRED = 'expired';
export const KIOSK_STATUS_CLOSED = 'closed';
