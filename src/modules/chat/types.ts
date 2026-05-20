export interface ChatSessionRow {
  id: string;
  userId: string;
  title: string | null;
  answerModelId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChatMessageRow {
  id: string;
  sessionId: string;
  role: string;
  content: string;
  citations: unknown;
  metadata: unknown;
  createdAt: Date;
}

export interface ChatMessageDto {
  id: string;
  sessionId: string;
  role: string;
  content: string;
  citations: unknown;
  reasoning: string | null;
  metadata: unknown;
  createdAt: Date;
}

export interface CitationItem {
  index: number;
  ragDocumentId: string;
  sourceType: string;
  sourceId: string;
  title: string;
  typeLabel: string;
  breadcrumbs: string[];
  heading: string | null;
  snippet: string;
  score: number;
  linkTo: string;
}

export interface MessageTurn {
  role: 'user' | 'assistant';
  content: string;
}
