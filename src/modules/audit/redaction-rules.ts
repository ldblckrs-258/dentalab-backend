import { createHmac } from 'crypto';

export type RedactionMode =
  | 'remove'
  | 'hash_last4'
  | 'hash_full'
  | 'hash_domain'
  | 'year_only';

export interface FieldRule {
  field: string;
  mode: RedactionMode;
}

export const REDACTION_RULES: Record<string, FieldRule[]> = {
  patient: [
    { field: 'nationalId', mode: 'hash_last4' },
    { field: 'national_id', mode: 'hash_last4' },
    { field: 'phone', mode: 'hash_last4' },
    { field: 'email', mode: 'hash_domain' },
    { field: 'address', mode: 'remove' },
    { field: 'dateOfBirth', mode: 'year_only' },
    { field: 'date_of_birth', mode: 'year_only' },
  ],
  user: [
    { field: 'passwordHash', mode: 'remove' },
    { field: 'password_hash', mode: 'remove' },
    { field: 'phone', mode: 'hash_last4' },
  ],
  clinical_note: [{ field: 'body', mode: 'remove' }],
  clinicalNote: [{ field: 'body', mode: 'remove' }],
  patient_file: [{ field: 'fileUrl', mode: 'hash_full' }],
  patientFile: [{ field: 'fileUrl', mode: 'hash_full' }],
};

function hmacSlice(key: string, value: string, len: number): string {
  return createHmac('sha256', key).update(value).digest('hex').slice(0, len);
}

function redactValue(
  mode: RedactionMode,
  value: unknown,
  hmacKey: string,
): unknown {
  if (value === undefined || value === null) return value;
  const str = typeof value === 'string' ? value : JSON.stringify(value);

  switch (mode) {
    case 'remove':
      return undefined;
    case 'hash_last4': {
      const last4 = str.length >= 4 ? str.slice(-4) : str;
      return `****${last4}`;
    }
    case 'hash_full':
      return { h: hmacSlice(hmacKey, str, 24) };
    case 'hash_domain': {
      const at = str.indexOf('@');
      if (at === -1) return { h: hmacSlice(hmacKey, str, 16) };
      const domain = str.slice(at);
      return { domain, localH: hmacSlice(hmacKey, str.slice(0, at), 12) };
    }
    case 'year_only': {
      const m = str.match(/\d{4}/);
      return m ? m[0] : '****';
    }
    default:
      return value;
  }
}

export function redactByResource(
  resource: string | undefined,
  data: Record<string, unknown> | undefined,
  hmacKey: string,
): Record<string, unknown> | undefined {
  if (!resource || !data) return data;
  const rules = REDACTION_RULES[resource];
  if (!rules?.length) return data;

  const next = { ...data };
  for (const { field, mode } of rules) {
    if (!(field in next)) continue;
    const v = redactValue(mode, next[field], hmacKey);
    if (v === undefined) delete next[field];
    else next[field] = v as unknown;
  }
  return next;
}
