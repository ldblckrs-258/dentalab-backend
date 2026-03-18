import { I18nContext } from 'nestjs-i18n';

/**
 * Mock I18nContext.current() to return a passthrough translator.
 * The mock `t()` returns the key itself (e.g., 'auth.invalid_credentials')
 * so tests can assert on translation keys rather than translated strings.
 */
export function mockI18nContext() {
  const mockI18n = {
    lang: 'en',
    t: jest.fn((key: string) => key),
  };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  jest.spyOn(I18nContext, 'current').mockReturnValue(mockI18n as any);
  return mockI18n;
}
