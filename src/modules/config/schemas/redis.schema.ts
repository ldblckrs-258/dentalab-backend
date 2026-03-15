import { z } from 'zod/v4';

export const redisSchema = z.object({
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_DB: z.coerce.number().default(0),
});

export type RedisConfig = z.infer<typeof redisSchema>;
