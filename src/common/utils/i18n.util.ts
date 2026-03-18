import { I18nContext } from 'nestjs-i18n';

export function t(
  key: string,
  fallback: string,
  args?: Record<string, unknown>,
): string {
  const i18n = I18nContext.current();
  return (i18n?.t(key, args ? { args } : undefined) as string) ?? fallback;
}
