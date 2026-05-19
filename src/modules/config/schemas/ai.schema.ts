import { z } from 'zod/v4';

export const aiSchema = z.object({
  AI_CONFIG_ENCRYPTION_KEY: z
    .string()
    .check(
      z.regex(
        /^[A-Za-z0-9+/]{43}=$/,
        'AI_CONFIG_ENCRYPTION_KEY must be 32 bytes base64 (44 chars incl. padding)',
      ),
    ),
  RAG_SERVICE_URL: z.string().default('http://localhost:8000'),
  RAG_SERVICE_TOKEN: z
    .string()
    .min(16, 'RAG_SERVICE_TOKEN must be at least 16 characters'),
  LLM_ANSWER_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  LLM_REWRITE_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
});

export type AiConfig = z.infer<typeof aiSchema>;
