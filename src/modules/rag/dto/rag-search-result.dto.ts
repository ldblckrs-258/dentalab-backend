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
