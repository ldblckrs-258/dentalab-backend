import { z } from 'zod/v4';

export const aiSchema = z.object({
  GEMINI_API_KEY: z.string().min(1),
  RAG_SERVICE_URL: z.string().default('http://localhost:8000'),
  RAG_SERVICE_TOKEN: z
    .string()
    .min(16, 'RAG_SERVICE_TOKEN must be at least 16 characters'),
});

export type AiConfig = z.infer<typeof aiSchema>;
