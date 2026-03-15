import { z } from 'zod/v4';

export const queueSchema = z.object({
  RABBITMQ_URL: z.string().min(1),
  RABBITMQ_PREFETCH_COUNT: z.coerce.number().default(10),
});

export type QueueConfig = z.infer<typeof queueSchema>;
