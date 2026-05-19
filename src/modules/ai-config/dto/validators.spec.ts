import { isSafeBaseUrl } from './validators';

describe('isSafeBaseUrl (SSRF baseline)', () => {
  it.each([
    'https://api.openai.com/v1',
    'https://api.anthropic.com/v1',
    'https://generativelanguage.googleapis.com',
    'https://googleapis.com',
    'https://my-proxy.example.com/v1',
    'https://custom.vendor.io/openai/v1',
    'https://8.8.8.8/v1',
  ])('accepts %s', (url) => {
    expect(isSafeBaseUrl(url)).toBe(true);
  });

  it.each([
    'http://api.openai.com/v1',
    'https://localhost/v1',
    'https://127.0.0.1/v1',
    'https://10.0.0.5/v1',
    'https://192.168.1.10/v1',
    'https://172.16.0.1/v1',
    'https://169.254.169.254/latest/meta-data',
    'https://0.0.0.0/v1',
    '://broken',
    'ftp://openai.com',
    '[::1]/v1',
  ])('rejects %s', (url) => {
    expect(isSafeBaseUrl(url)).toBe(false);
  });

  it('accepts undefined/empty (optional field)', () => {
    expect(isSafeBaseUrl(undefined)).toBe(true);
    expect(isSafeBaseUrl('')).toBe(true);
  });
});
