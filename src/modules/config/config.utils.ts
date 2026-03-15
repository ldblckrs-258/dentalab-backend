const SENSITIVE_KEYWORDS = [
  'SECRET',
  'PASSWORD',
  'KEY',
  'TOKEN',
  'HASH',
  'API_KEY',
];

export function maskSensitiveValues(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const masked: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(config)) {
    if (typeof value === 'object' && value !== null) {
      masked[key] = maskSensitiveValues(value as Record<string, unknown>);
    } else if (
      typeof value === 'string' &&
      SENSITIVE_KEYWORDS.some((keyword) => key.toUpperCase().includes(keyword))
    ) {
      masked[key] = value.length > 4 ? '****' + value.slice(-4) : '****';
    } else {
      masked[key] = value;
    }
  }

  return masked;
}
