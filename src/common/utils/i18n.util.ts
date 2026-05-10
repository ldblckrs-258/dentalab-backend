import { I18nContext, I18nService } from 'nestjs-i18n';
import { DEFAULT_LANGUAGE } from '@common/constants';

export function t(
  key: string,
  fallback: string,
  args?: Record<string, unknown>,
): string {
  const i18n = I18nContext.current();
  const value = i18n?.t(key, args ? { args } : undefined) as string | undefined;
  // nestjs-i18n returns the key itself when no translation exists.
  // Treat that as a miss and use the fallback.
  if (!value || value === key) return fallback;
  return value;
}

export function resolveLang(lang?: string | null): string {
  return lang ?? DEFAULT_LANGUAGE;
}

export function translateWithLang(
  i18n: I18nService,
  key: string,
  lang: string,
  args?: Record<string, unknown>,
): string {
  return i18n.translate(key, { lang, args });
}
