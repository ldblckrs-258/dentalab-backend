import { BadRequestException } from '@nestjs/common';
import {
  buildObjectKey,
  validateFileSize,
  validateMimeType,
} from './storage.utils';

describe('storage.utils', () => {
  describe('buildObjectKey', () => {
    it('should build key with category/entityId/uuid-filename format', () => {
      const key = buildObjectKey('patients', 'entity-123', 'photo.jpg');
      expect(key).toMatch(/^patients\/entity-123\/[a-f0-9-]+-photo\.jpg$/);
    });

    it('should sanitize unsafe characters in filename', () => {
      const key = buildObjectKey('docs', 'e1', 'my file (1).pdf');
      expect(key).toMatch(/^docs\/e1\/[a-f0-9-]+-my_file__1_.pdf$/);
    });

    it('should preserve safe characters in filename', () => {
      const key = buildObjectKey('docs', 'e1', 'report-2024_v2.pdf');
      expect(key).toMatch(/report-2024_v2\.pdf$/);
    });
  });

  describe('validateFileSize', () => {
    it('should not throw when size is within limit', () => {
      expect(() => validateFileSize(1000, 5000)).not.toThrow();
    });

    it('should not throw when size equals limit', () => {
      expect(() => validateFileSize(5000, 5000)).not.toThrow();
    });

    it('should throw BadRequestException when size exceeds limit', () => {
      expect(() => validateFileSize(5001, 5000)).toThrow(BadRequestException);
    });
  });

  describe('validateMimeType', () => {
    it('should accept allowed MIME types', () => {
      const allowedTypes = [
        'image/jpeg',
        'image/png',
        'image/webp',
        'application/pdf',
      ];
      allowedTypes.forEach((type) => {
        expect(() => validateMimeType(type)).not.toThrow();
      });
    });

    it('should reject disallowed MIME types', () => {
      expect(() => validateMimeType('text/plain')).toThrow(BadRequestException);
      expect(() => validateMimeType('application/exe')).toThrow(
        BadRequestException,
      );
    });
  });
});
