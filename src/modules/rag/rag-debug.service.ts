import { AppConfigService } from '@modules/config';
import {
  GatewayTimeoutException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { RagDebugSearchDto } from './dto/rag-debug-search.dto';

const DEBUG_WORKER_TIMEOUT_MS = 125_000;

@Injectable()
export class RagDebugService {
  private readonly logger = new Logger(RagDebugService.name);

  constructor(private readonly config: AppConfigService) {}

  async debugSearch(dto: RagDebugSearchDto): Promise<unknown> {
    const { RAG_SERVICE_URL, RAG_SERVICE_TOKEN } = this.config.ai;
    const url = `${RAG_SERVICE_URL.replace(/\/$/, '')}/query/debug`;

    const body: Record<string, unknown> = {
      query: dto.query,
      user_id: dto.userId,
    };
    if (dto.topK !== undefined) body.top_k = dto.topK;
    if (dto.rerankPoolMultiplier !== undefined) {
      body.rerank_pool_multiplier = dto.rerankPoolMultiplier;
    }
    if (dto.rerankMaxLength !== undefined) {
      body.rerank_max_length = dto.rerankMaxLength;
    }
    if (dto.rerankTimeoutMs !== undefined) {
      body.rerank_timeout_ms = dto.rerankTimeoutMs;
    }
    if (dto.skipRerank !== undefined) body.skip_rerank = dto.skipRerank;
    if (dto.sourceTypes !== undefined) body.source_types = dto.sourceTypes;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), DEBUG_WORKER_TIMEOUT_MS);

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
      if ((err as Error).name === 'AbortError') {
        this.logger.error(
          `RAG worker debug timed out after ${DEBUG_WORKER_TIMEOUT_MS}ms`,
        );
        throw new GatewayTimeoutException('RAG worker timed out');
      }
      const msg = (err as Error).message;
      this.logger.error(`RAG worker unreachable: ${msg}`);
      throw new ServiceUnavailableException('RAG worker unreachable');
    }
    clearTimeout(timer);

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.warn(`RAG worker debug ${res.status}: ${text.slice(0, 200)}`);
      throw new HttpException(
        text || 'RAG worker error',
        res.status >= 400 && res.status < 600
          ? res.status
          : HttpStatus.BAD_GATEWAY,
      );
    }

    try {
      return await res.json();
    } catch {
      this.logger.warn('RAG worker debug returned non-JSON body');
      throw new HttpException(
        'RAG worker returned invalid JSON',
        HttpStatus.BAD_GATEWAY,
      );
    }
  }
}
