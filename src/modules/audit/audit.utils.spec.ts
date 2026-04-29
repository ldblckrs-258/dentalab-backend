import { isPairedDiffEmpty, pairedDiff } from './audit.utils';
import { redactByResource } from './redaction-rules';

describe('audit.utils', () => {
  describe('pairedDiff', () => {
    it('should return changed keys on both sides', () => {
      const oldData = { name: 'Alice', email: 'a@test.com' };
      const newData = { name: 'Bob', email: 'a@test.com' };
      expect(pairedDiff(oldData, newData)).toEqual({
        before: { name: 'Alice' },
        after: { name: 'Bob' },
      });
    });

    it('should return empty before and after when identical', () => {
      const data = { name: 'Alice', email: 'a@test.com' };
      const d = pairedDiff(data, { ...data });
      expect(isPairedDiffEmpty(d.before, d.after)).toBe(true);
    });

    it('should skip keys present on only one side (schema-mismatch noise)', () => {
      const oldData = { name: 'Alice' };
      const newData = { name: 'Alice', role: 'admin' };
      const d = pairedDiff(oldData, newData);
      expect(isPairedDiffEmpty(d.before, d.after)).toBe(true);
    });

    it('should diff a field that exists on both sides with a null/value transition', () => {
      const oldData = { name: 'Alice', role: null };
      const newData = { name: 'Alice', role: 'admin' };
      expect(pairedDiff(oldData, newData)).toEqual({
        before: { role: null },
        after: { role: 'admin' },
      });
    });

    it('should ignore updatedAt', () => {
      const oldData = { name: 'A', updatedAt: '1' };
      const newData = { name: 'A', updatedAt: '2' };
      const d = pairedDiff(oldData, newData);
      expect(isPairedDiffEmpty(d.before, d.after)).toBe(true);
    });
  });

  describe('redactByResource', () => {
    it('should redact user password fields', () => {
      const data = {
        email: 'a@test.com',
        password_hash: 'hash',
        phone: '+84901234567',
      };
      const result = redactByResource('user', data, 'test-hmac-key');
      expect(result?.email).toBeDefined();
      expect(result?.password_hash).toBeUndefined();
      expect(result?.phone).toBe('****4567');
    });
  });
});
