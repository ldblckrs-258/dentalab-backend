import { z } from 'zod/v4';

export const jwtSchema = z.object({
  JWT_SECRET: z.string().min(1),
  JWT_ACCESS_EXPIRY: z.string().default('15m'),
  JWT_REFRESH_EXPIRY: z.string().default('7d'),
});

export type JwtConfig = z.infer<typeof jwtSchema>;
