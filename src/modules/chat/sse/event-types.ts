import type { CitationItem } from '../types';

export interface SessionEventPayload {
  sessionId: string;
  userMessageId: string;
}

export interface RewrittenEventPayload {
  query: string;
}

export interface CitationsEventPayload {
  sources: CitationItem[];
}

export interface DeltaEventPayload {
  text: string;
}

export interface ReasoningEventPayload {
  text: string;
}

export interface DoneEventPayload {
  messageId: string;
  timing: {
    totalMs: number;
    firstChunkMs: number | null;
  };
}

export interface ErrorEventPayload {
  code: string;
  message?: string;
  retryAfter?: number;
}

export type ChatStreamEvent =
  | 'session'
  | 'rewritten'
  | 'citations'
  | 'delta'
  | 'reasoning'
  | 'done'
  | 'error';
