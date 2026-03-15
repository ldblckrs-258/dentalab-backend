import { SENSITIVE_FIELDS } from '@common/constants';

export function shallowDiff(
  oldData: Record<string, unknown>,
  newData: Record<string, unknown>,
): Record<string, unknown> {
  const diff: Record<string, unknown> = {};
  for (const key of Object.keys(newData)) {
    if (JSON.stringify(oldData[key]) !== JSON.stringify(newData[key])) {
      diff[key] = newData[key];
    }
  }
  return diff;
}

export function redactSensitiveFields(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (SENSITIVE_FIELDS.includes(key)) {
      redacted[key] = '[REDACTED]';
    } else if (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value)
    ) {
      redacted[key] = redactSensitiveFields(value as Record<string, unknown>);
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}
