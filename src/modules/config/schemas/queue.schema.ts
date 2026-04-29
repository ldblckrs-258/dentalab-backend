import { z } from 'zod/v4';

export const queueSchema = z.object({
  RABBITMQ_URL: z.string().min(1),
  RABBITMQ_PREFETCH_COUNT: z.coerce.number().default(10),
  AUDIT_BATCH_MAX: z.coerce.number().default(500),
  AUDIT_BATCH_INTERVAL_MS: z.coerce.number().default(1000),
  AUDIT_HOT_RETENTION_DAYS: z.coerce.number().default(90),
  AUDIT_COLD_RETENTION_YEARS: z.coerce.number().default(10),
  AUDIT_REDACTION_HMAC_KEY: z
    .string()
    .min(1)
    .default('dev-audit-redaction-key-change-in-production'),
  AUDIT_S3_BUCKET: z.string().optional(),
});

export type QueueConfig = z.infer<typeof queueSchema>;
