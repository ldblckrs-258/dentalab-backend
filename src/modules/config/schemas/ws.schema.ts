import { z } from 'zod/v4';

export const wsSchema = z.object({
  WS_PING_INTERVAL_MS: z.coerce.number().default(25000),
  WS_PING_TIMEOUT_MS: z.coerce.number().default(60000),
  WS_DRAIN_MS: z.coerce.number().nonnegative().default(2000),
});

export type WsConfig = z.infer<typeof wsSchema>;
