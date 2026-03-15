import { toVietnamTime, formatDate } from './date.utils';

describe('date.utils', () => {
  describe('toVietnamTime', () => {
    it('should convert UTC date to Vietnam timezone', () => {
      // 2024-01-15 00:00:00 UTC = 2024-01-15 07:00:00 ICT (UTC+7)
      const utcDate = new Date('2024-01-15T00:00:00Z');
      const vnDate = toVietnamTime(utcDate);
      expect(vnDate.getHours()).toBe(7);
      expect(vnDate.getDate()).toBe(15);
    });

    it('should handle date that crosses midnight in Vietnam', () => {
      // 2024-01-15 20:00:00 UTC = 2024-01-16 03:00:00 ICT
      const utcDate = new Date('2024-01-15T20:00:00Z');
      const vnDate = toVietnamTime(utcDate);
      expect(vnDate.getDate()).toBe(16);
      expect(vnDate.getHours()).toBe(3);
    });
  });

  describe('formatDate', () => {
    const testDate = new Date('2024-06-15T10:30:45Z');

    it('should format as date only', () => {
      const result = formatDate(testDate, 'date');
      expect(result).toMatch(/\d{2}\/\d{2}\/\d{4}/);
    });

    it('should format as time only', () => {
      const result = formatDate(testDate, 'time');
      expect(result).toMatch(/\d{2}:\d{2}:\d{2}/);
    });

    it('should format as datetime by default', () => {
      const result = formatDate(testDate);
      expect(result).toMatch(/\d{2}\/\d{2}\/\d{4}/);
      expect(result).toMatch(/\d{2}:\d{2}:\d{2}/);
    });
  });
});
