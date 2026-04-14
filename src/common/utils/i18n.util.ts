import { I18nContext, I18nService } from 'nestjs-i18n';
import { DEFAULT_LANGUAGE } from '@common/constants';

export function t(
  key: string,
  fallback: string,
  args?: Record<string, unknown>,
): string {
  const i18n = I18nContext.current();
  return (i18n?.t(key, args ? { args } : undefined) as string) ?? fallback;
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
