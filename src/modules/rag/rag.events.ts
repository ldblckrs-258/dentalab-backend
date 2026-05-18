import { z } from 'zod';

export const ragStageSchema = z.enum(['extracting', 'chunking', 'embedding']);
export type RagStage = z.infer<typeof ragStageSchema>;

export const ragStatusEventSchema = z.object({
  sourceType: z.literal('internal_document'),
  sourceId: z.uuid(),
  ragDocumentId: z.uuid(),
  status: z.enum(['processing', 'completed', 'failed']),
  errorMessage: z.string().optional(),
  totalParentChunks: z.number().int().nonnegative().optional(),
  totalChildChunks: z.number().int().nonnegative().optional(),
  ingestionTimeMs: z.number().int().nonnegative().optional(),
  contentHash: z.string().optional(),
  stage: ragStageSchema.optional(),
  progressCurrent: z.number().int().nonnegative().optional(),
  progressTotal: z.number().int().positive().optional(),
  occurredAt: z.iso.datetime(),
});

export type RagStatusEvent = z.infer<typeof ragStatusEventSchema>;

export interface RagEvents {
  'rag.status': RagStatusEvent;
}
