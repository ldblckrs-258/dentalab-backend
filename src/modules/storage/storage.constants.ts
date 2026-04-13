export const S3_CLIENT = 'S3_CLIENT';

export const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/dicom',
];

export const DEFAULT_PRESIGNED_EXPIRY = 3600; // 1 hour

// Avatar-specific constants
export const AVATAR_MAX_SIZE = 2 * 1024 * 1024; // 2MB
export const AVATAR_ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
];
export const AVATAR_DIMENSION = 256; // 256x256 px
