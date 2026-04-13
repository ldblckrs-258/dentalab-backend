import { BadRequestException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
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
    throw new BadRequestException(
      `File size ${size} exceeds maximum allowed size of ${maxSize} bytes`,
    );
  }
}

export function validateMimeType(
  mimeType: string,
  allowedTypes: string[] = ALLOWED_MIME_TYPES,
): void {
  if (!allowedTypes.includes(mimeType)) {
    throw new BadRequestException(
      `File type '${mimeType}' is not allowed. Allowed types: ${allowedTypes.join(', ')}`,
    );
  }
}
