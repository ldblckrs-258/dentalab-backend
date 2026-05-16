export const S3_CLIENT = 'S3_CLIENT';

export const ALLOWED_MIME_TYPES = [
  // Images
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/bmp',
  'image/svg+xml',
  // Documents
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/dicom',
  // Text / data
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/tab-separated-values',
  'text/xml',
  'application/xml',
  'application/json',
  'application/x-yaml',
  'text/yaml',
];

export const DEFAULT_PRESIGNED_EXPIRY = 3600;

export const AVATAR_MAX_SIZE = 2 * 1024 * 1024;
export const AVATAR_ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
];
export const AVATAR_DIMENSION = 256;

export const INTERNAL_DOC_ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'image/png',
  'image/jpeg',
];

export const INTERNAL_DOC_MAX_SIZE = 25 * 1024 * 1024;

export const INTERNAL_DOC_PRESIGNED_EXPIRY = 300;

export const INLINE_DISPLAY_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
];
