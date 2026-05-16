import { BadRequestException } from '@nestjs/common';
import { INTERNAL_DOC_ALLOWED_MIME_TYPES } from './storage.constants';
import {
  buildObjectKey,
  validateFileSize,
  validateMagicBytes,
  validateMimeType,
} from './storage.utils';

const PDF_MAGIC = Buffer.from('%PDF-1.4 test content');
const PNG_MAGIC = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52,
]);
const RANDOM_BYTES = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]);

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
      expect(() => validateMimeType('application/x-msdownload')).toThrow(
        BadRequestException,
      );
      expect(() => validateMimeType('application/exe')).toThrow(
        BadRequestException,
      );
    });
  });

  describe('validateMagicBytes', () => {
    it('should pass for a valid PDF buffer declared as application/pdf', async () => {
      const detector = jest.fn().mockResolvedValue({ mime: 'application/pdf' });
      await expect(
        validateMagicBytes(
          PDF_MAGIC,
          'application/pdf',
          INTERNAL_DOC_ALLOWED_MIME_TYPES,
          detector,
        ),
      ).resolves.toBeUndefined();
    });

    it('should throw when PDF buffer is declared as image/png (MIME mismatch)', async () => {
      const detector = jest.fn().mockResolvedValue({ mime: 'application/pdf' });
      await expect(
        validateMagicBytes(
          PDF_MAGIC,
          'image/png',
          INTERNAL_DOC_ALLOWED_MIME_TYPES,
          detector,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw when random bytes are submitted (unknown type, detector returns undefined)', async () => {
      const detector = jest.fn().mockResolvedValue(undefined);
      await expect(
        validateMagicBytes(
          RANDOM_BYTES,
          'application/pdf',
          INTERNAL_DOC_ALLOWED_MIME_TYPES,
          detector,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw when detected MIME is not in the allowlist', async () => {
      const detector = jest.fn().mockResolvedValue({ mime: 'image/gif' });
      await expect(
        validateMagicBytes(
          Buffer.alloc(8),
          'image/gif',
          INTERNAL_DOC_ALLOWED_MIME_TYPES,
          detector,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should pass for valid PNG buffer declared as image/png', async () => {
      const detector = jest.fn().mockResolvedValue({ mime: 'image/png' });
      await expect(
        validateMagicBytes(
          PNG_MAGIC,
          'image/png',
          INTERNAL_DOC_ALLOWED_MIME_TYPES,
          detector,
        ),
      ).resolves.toBeUndefined();
    });
  });
});
