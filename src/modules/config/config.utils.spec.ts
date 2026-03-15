import { maskSensitiveValues } from './config.utils';

describe('maskSensitiveValues', () => {
  it('should mask values with sensitive keywords in keys', () => {
    const config = {
      JWT_SECRET: 'my-super-secret-key',
      DATABASE_PASSWORD: 'db-password-123',
      API_KEY: 'key-abcdef',
    };
    const result = maskSensitiveValues(config);
    expect(result.JWT_SECRET).toBe('****-key');
    expect(result.DATABASE_PASSWORD).toBe('****-123');
    expect(result.API_KEY).toBe('****cdef');
  });

  it('should not mask non-sensitive values', () => {
    const config = {
      PORT: '3000',
      NODE_ENV: 'development',
      HOST: 'localhost',
    };
    const result = maskSensitiveValues(config);
    expect(result).toEqual(config);
  });

  it('should handle short sensitive values', () => {
    const config = { TOKEN: 'abc' };
    const result = maskSensitiveValues(config);
    expect(result.TOKEN).toBe('****');
  });

  it('should handle exactly 4 char sensitive values', () => {
    const config = { TOKEN: 'abcd' };
    const result = maskSensitiveValues(config);
    expect(result.TOKEN).toBe('****');
  });

  it('should handle 5+ char sensitive values showing last 4', () => {
    const config = { TOKEN: 'abcde' };
    const result = maskSensitiveValues(config);
    expect(result.TOKEN).toBe('****bcde');
  });

  it('should recursively mask nested objects', () => {
    const config = {
      database: {
        PASSWORD: 'secret123',
        host: 'localhost',
      },
    };
    const result = maskSensitiveValues(config) as Record<
      string,
      Record<string, unknown>
    >;
    expect(result.database.PASSWORD).toBe('****t123');
    expect(result.database.host).toBe('localhost');
  });

  it('should preserve non-string values', () => {
    const config = { PORT: 3000, DEBUG: true };
    const result = maskSensitiveValues(config);
    expect(result.PORT).toBe(3000);
    expect(result.DEBUG).toBe(true);
  });

  it('should be case-insensitive for keyword matching', () => {
    const config = {
      jwt_secret: 'my-secret',
      db_password: 'pass123',
    };
    const result = maskSensitiveValues(config);
    expect(result.jwt_secret).toBe('****cret');
    expect(result.db_password).toBe('****s123');
  });
});
