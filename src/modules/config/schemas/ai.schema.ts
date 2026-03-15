import { z } from 'zod/v4';

export const aiSchema = z.object({
  GEMINI_API_KEY: z.string().min(1),
  RAG_SERVICE_URL: z.string().default('http://localhost:8000'),
});

export type AiConfig = z.infer<typeof aiSchema>;
