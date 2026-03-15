import { z } from 'zod/v4';

export const appSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z
    .enum(['development', 'staging', 'production'])
    .default('development'),
  API_PREFIX: z.string().default('api/v1'),
  CORS_ORIGINS: z.string().default('*'),
  APP_NAME: z.string().default('DentaLab API'),
});

export type AppConfig = z.infer<typeof appSchema>;
