import { BadRequestException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { t } from '@common/utils';
import { ALLOWED_MIME_TYPES } from './storage.constants';

export function buildObjectKey(
  category: string,
  entityId: string,
  originalFilename: string,
): string {
  const safeFilename = originalFilename.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `${category}/${entityId}/${uuidv4()}-${safeFilename}`;
}

export function validateFileSize(size: number, maxSize: number): void {
  if (size > maxSize) {
    const maxMb = Math.max(1, Math.round(maxSize / 1024 / 1024));
    throw new BadRequestException(
      t(
        'storage.file_size_exceeded',
        `File is too large. Maximum allowed size is ${maxMb} MB.`,
        { maxMb },
      ),
    );
  }
}

export function validateMimeType(
  mimeType: string,
  allowedTypes: string[] = ALLOWED_MIME_TYPES,
): void {
  if (!allowedTypes.includes(mimeType)) {
    throw new BadRequestException(
      t(
        'storage.file_type_not_allowed',
        'This file type is not supported. Please upload images (JPG, PNG, WEBP, GIF), PDF, Word documents, or text files (TXT, MD, CSV, JSON).',
      ),
    );
  }
}
