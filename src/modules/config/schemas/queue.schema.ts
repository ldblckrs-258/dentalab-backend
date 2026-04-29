import { z } from 'zod/v4';

export const queueSchema = z.object({
  RABBITMQ_URL: z.string().min(1),
  RABBITMQ_PREFETCH_COUNT: z.coerce.number().default(10),
  AUDIT_REDACTION_HMAC_KEY: z
    .string()
    .min(1)
    .default('dev-audit-redaction-key-change-in-production'),
});

export type QueueConfig = z.infer<typeof queueSchema>;
