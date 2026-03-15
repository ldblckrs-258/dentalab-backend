import { shallowDiff, redactSensitiveFields } from './audit.utils';

describe('audit.utils', () => {
  describe('shallowDiff', () => {
    it('should return changed fields', () => {
      const oldData = { name: 'Alice', email: 'a@test.com' };
      const newData = { name: 'Bob', email: 'a@test.com' };
      expect(shallowDiff(oldData, newData)).toEqual({ name: 'Bob' });
    });

    it('should return empty object when no changes', () => {
      const data = { name: 'Alice', email: 'a@test.com' };
      expect(shallowDiff(data, { ...data })).toEqual({});
    });

    it('should detect new fields in newData', () => {
      const oldData = { name: 'Alice' };
      const newData = { name: 'Alice', role: 'admin' };
      expect(shallowDiff(oldData, newData)).toEqual({ role: 'admin' });
    });

    it('should handle nested object changes via JSON comparison', () => {
      const oldData = { meta: { a: 1 } };
      const newData = { meta: { a: 2 } };
      expect(shallowDiff(oldData, newData)).toEqual({ meta: { a: 2 } });
    });

    it('should return empty for identical nested objects', () => {
      const oldData = { meta: { a: 1 } };
      const newData = { meta: { a: 1 } };
      expect(shallowDiff(oldData, newData)).toEqual({});
    });
  });

  describe('redactSensitiveFields', () => {
    it('should redact known sensitive fields', () => {
      const data = {
        email: 'a@test.com',
        password_hash: 'abc123',
        token_hash: 'xyz',
      };
      const result = redactSensitiveFields(data);
      expect(result.email).toBe('a@test.com');
      expect(result.password_hash).toBe('[REDACTED]');
      expect(result.token_hash).toBe('[REDACTED]');
    });

    it('should recursively redact nested objects', () => {
      const data = {
        user: { name: 'Alice', password: 'secret' },
      };
      const result = redactSensitiveFields(data);
      expect(result.user).toEqual({ name: 'Alice', password: '[REDACTED]' });
    });

    it('should preserve arrays and non-sensitive values', () => {
      const data = { tags: ['a', 'b'], name: 'test' };
      const result = redactSensitiveFields(data);
      expect(result).toEqual({ tags: ['a', 'b'], name: 'test' });
    });

    it('should redact all known sensitive field names', () => {
      const fields = [
        'password_hash',
        'token_hash',
        'ssn',
        'credit_card',
        'password',
        'secret',
        'refresh_token',
        'access_token',
      ];
      const data: Record<string, string> = {};
      fields.forEach((f) => (data[f] = 'value'));

      const result = redactSensitiveFields(data);
      fields.forEach((f) => {
        expect(result[f]).toBe('[REDACTED]');
      });
    });
  });
});
