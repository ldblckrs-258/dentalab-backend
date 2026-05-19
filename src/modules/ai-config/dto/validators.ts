import {
  ValidatorConstraint,
  type ValidatorConstraintInterface,
  type ValidationArguments,
} from 'class-validator';

export const PROVIDER_KINDS = ['openai', 'gemini', 'anthropic'] as const;

function isPrivateIPv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

export function isSafeBaseUrl(raw?: string): boolean {
  if (!raw) return true;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  if (host === 'localhost') return false;
  if (host.startsWith('[') || host.includes(':')) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    if (isPrivateIPv4(host)) return false;
  }
  return true;
}

@ValidatorConstraint({ name: 'IsSafeBaseUrl', async: false })
export class IsSafeBaseUrlConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (value === undefined || value === null) return true;
    if (typeof value !== 'string') return false;
    return isSafeBaseUrl(value);
  }
  defaultMessage(_args: ValidationArguments): string {
    return 'baseUrl must be https and must not point to a private/loopback/link-local address';
  }
}
