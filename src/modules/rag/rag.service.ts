import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@modules/database';
import { QueueProducerService } from '@modules/queue';
import { CacheService } from '@modules/redis';
import { DocumentService } from '@modules/document';
import type { AuthenticatedUser } from '@common/interfaces';
import type { RagStatusDto } from './dto/rag-status.dto';

const RAG_REINDEX_RATE_LIMIT_TTL = 10;

@Injectable()
export class RagService {
  private readonly logger = new Logger(RagService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueProducerService,
    private readonly cache: CacheService,
    private readonly documentService: DocumentService,
  ) {}

  async getRagStatus(
    documentId: string,
    user: AuthenticatedUser & { permissions?: string[] },
  ): Promise<RagStatusDto> {
    await this.documentService.findById(documentId, user);

    const row = await this.prisma.baseClient.ragDocument.findFirst({
      where: { sourceType: 'internal_document', sourceId: documentId },
      orderBy: { createdAt: 'desc' },
    });

    if (!row) {
      throw new NotFoundException('RAG status not found for this document');
    }

    return {
      id: row.id,
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      status: row.status,
      errorMessage: row.errorMessage,
      totalParentChunks: row.totalParentChunks,
      totalChildChunks: row.totalChildChunks,
      contentHash: row.contentHash,
      ingestionTimeMs: row.ingestionTimeMs,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async reindex(
    documentId: string,
    user: AuthenticatedUser & { permissions?: string[] },
  ): Promise<{ accepted: true }> {
    await this.documentService.findById(documentId, user);

    const acquired = await this.cache.setWithNX(
      'rag:reindex',
      documentId,
      1,
      RAG_REINDEX_RATE_LIMIT_TTL,
    );

    if (!acquired) {
      throw new HttpException(
        'Reindex already in progress for this document',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    try {
      this.queue.publishDocumentUpdated(documentId);
    } catch (err) {
      this.logger.warn(
        `Failed to publish reindex for ${documentId}: ${(err as Error).message}`,
      );
    }

    return { accepted: true };
  }
}
