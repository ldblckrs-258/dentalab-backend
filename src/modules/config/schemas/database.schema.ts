import { z } from 'zod/v4';

export const databaseSchema = z.object({
  DATABASE_URL: z.string().min(1),
  DB_POOL_MIN: z.coerce.number().default(2),
  DB_POOL_MAX: z.coerce.number().default(10),
});

export type DatabaseConfig = z.infer<typeof databaseSchema>;
