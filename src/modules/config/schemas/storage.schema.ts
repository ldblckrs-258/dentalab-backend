import { z } from 'zod/v4';

export const storageSchema = z.object({
  S3_ENDPOINT: z.string().min(1),
  S3_REGION: z.string().default('auto'),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_MAX_FILE_SIZE: z.coerce.number().default(52428800), // 50MB
});

export type StorageConfig = z.infer<typeof storageSchema>;
