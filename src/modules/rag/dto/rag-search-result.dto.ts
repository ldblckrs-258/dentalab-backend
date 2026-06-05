export interface RagSearchResult {
  childChunkId: string;
  parentChunkId: string;
  ragDocumentId: string;
  sourceType: string;
  sourceId: string;
  filename: string | null;
  childContent: string;
  parentContent: string;
  score: number;
  metadata: Record<string, unknown> | null;
  heading: string | null;
  headingLevel: number;
  breadcrumbs: string[];
  pageStart?: number;
  pageEnd?: number;
}

export function extractPageRange(metadata: Record<string, unknown> | null): {
  pageStart?: number;
  pageEnd?: number;
} {
  const pageStart = metadata?.page_start;
  if (typeof pageStart !== 'number') return {};
  const pageEnd = metadata?.page_end;
  return {
    pageStart,
    pageEnd: typeof pageEnd === 'number' ? pageEnd : pageStart,
  };
}

export interface RagSearchTiming {
  embedQueryMs: number;
  ftsQueryMs: number;
  vectorQueryMs: number;
  rerankMs: number;
  parentExpandMs: number;
  totalMs: number;
}

export interface RagSearchResponse {
  query: string;
  results: RagSearchResult[];
  total: number;
  timing: RagSearchTiming;
}
