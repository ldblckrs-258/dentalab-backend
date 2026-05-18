import type { AuthenticatedUser } from '@common/interfaces';
import { AppConfigService } from '@modules/config';
import { DocumentService } from '@modules/document';
import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type {
  RagSearchResponse,
  RagSearchResult,
  RagSearchTiming,
} from './dto/rag-search-result.dto';
import type { RagSearchDto } from './dto/rag-search.dto';

interface WorkerSearchResult {
  child_chunk_id: string;
  parent_chunk_id: string;
  rag_document_id: string;
  source_type: string;
  source_id: string;
  filename: string | null;
  child_content: string;
  parent_content: string;
  score: number;
  metadata: Record<string, unknown> | null;
  heading: string | null;
  heading_level: number;
  breadcrumbs: string[];
}

interface WorkerSearchTiming {
  embed_query_ms: number;
  fts_query_ms: number;
  vector_query_ms: number;
  rerank_ms: number;
  parent_expand_ms: number;
  total_ms: number;
}

interface WorkerSearchResponse {
  query: string;
  results: WorkerSearchResult[];
  total: number;
  timing: WorkerSearchTiming;
}

const WORKER_TIMEOUT_MS = 15_000;

@Injectable()
export class RagSearchService {
  private readonly logger = new Logger(RagSearchService.name);

  constructor(
    private readonly config: AppConfigService,
    private readonly documentService: DocumentService,
  ) {}

  async search(
    dto: RagSearchDto,
    user: AuthenticatedUser,
  ): Promise<RagSearchResponse> {
    const permissionIds = await this.documentService.getUserPermissionIds(
      user.id,
    );

    const { RAG_SERVICE_URL, RAG_SERVICE_TOKEN } = this.config.ai;
    const url = `${RAG_SERVICE_URL.replace(/\/$/, '')}/query`;

    const body = {
      query: dto.query,
      permission_ids: permissionIds,
      top_k: dto.topK,
      min_score: dto.minScore,
      source_types: dto.sourceTypes ?? ['internal_document'],
    };

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), WORKER_TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Token': RAG_SERVICE_TOKEN,
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      const msg = (err as Error).message;
      this.logger.error(`RAG worker unreachable: ${msg}`);
      throw new ServiceUnavailableException('RAG worker unreachable');
    }
    clearTimeout(timer);

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.warn(`RAG worker ${res.status}: ${text.slice(0, 200)}`);
      throw new HttpException(
        text || 'RAG worker error',
        res.status >= 400 && res.status < 600
          ? res.status
          : HttpStatus.BAD_GATEWAY,
      );
    }

    const data = (await res.json()) as WorkerSearchResponse;
    return this.toCamel(data);
  }

  private toCamel(data: WorkerSearchResponse): RagSearchResponse {
    return {
      query: data.query,
      total: data.total,
      results: data.results.map((r) => this.resultToCamel(r)),
      timing: this.timingToCamel(data.timing),
    };
  }

  private resultToCamel(r: WorkerSearchResult): RagSearchResult {
    return {
      childChunkId: r.child_chunk_id,
      parentChunkId: r.parent_chunk_id,
      ragDocumentId: r.rag_document_id,
      sourceType: r.source_type,
      sourceId: r.source_id,
      filename: r.filename,
      childContent: r.child_content,
      parentContent: r.parent_content,
      score: r.score,
      metadata: r.metadata,
      heading: r.heading ?? null,
      headingLevel: r.heading_level ?? 0,
      breadcrumbs: r.breadcrumbs ?? [],
    };
  }

  private timingToCamel(t: WorkerSearchTiming): RagSearchTiming {
    return {
      embedQueryMs: t.embed_query_ms,
      ftsQueryMs: t.fts_query_ms,
      vectorQueryMs: t.vector_query_ms,
      rerankMs: t.rerank_ms,
      parentExpandMs: t.parent_expand_ms,
      totalMs: t.total_ms,
    };
  }
}
