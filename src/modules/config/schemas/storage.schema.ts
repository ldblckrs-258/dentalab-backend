import { z } from 'zod/v4';

export const storageSchema = z
  .object({
    S3_ENDPOINT: z.string().min(1),
    S3_REGION: z.string().default('auto'),
    S3_BUCKET: z.string().min(1),
    S3_PUBLIC_BUCKET: z.string().optional(),
    S3_ACCESS_KEY: z.string().min(1),
    S3_SECRET_KEY: z.string().min(1),
    S3_MAX_FILE_SIZE: z.coerce.number().default(52428800),
    S3_PUBLIC_URL: z.string().optional(),
    S3_SSE_ENABLED: z
      .union([z.boolean(), z.string()])
      .transform((v) => (typeof v === 'string' ? v === 'true' : v))
      .default(false),
  })
  .superRefine((data, ctx) => {
    if (
      process.env.NODE_ENV === 'production' &&
      !data.S3_ENDPOINT.startsWith('https://')
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'S3_ENDPOINT must use HTTPS in production',
        path: ['S3_ENDPOINT'],
      });
    }
  });

export type StorageConfig = z.infer<typeof storageSchema>;
