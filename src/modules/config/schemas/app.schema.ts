import { z } from 'zod/v4';

export const appSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z
    .enum(['development', 'staging', 'production'])
    .default('development'),
  API_PREFIX: z.string().default('api/v1'),
  CORS_ORIGINS: z.string().default('*'),
  APP_NAME: z.string().default('DentaLab API'),
  MAX_LOGIN_ATTEMPTS: z.coerce.number().int().positive().default(5),
  LOCKOUT_DURATION_MINUTES: z.coerce.number().int().positive().default(15),
  SCHEDULE_OVERRIDE_STALE_DAYS: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(3),
});

export type AppConfig = z.infer<typeof appSchema>;
