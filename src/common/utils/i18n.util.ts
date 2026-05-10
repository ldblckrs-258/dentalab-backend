import { DEFAULT_LANGUAGE } from '@common/constants';
import { I18nContext, I18nService } from 'nestjs-i18n';

export function t(
  key: string,
  fallback: string,
  args?: Record<string, unknown>,
): string {
  const i18n = I18nContext.current();
  const value = i18n?.t(key, args ? { args } : undefined);

  if (!value || value === key) return fallback;
  return value as string;
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
