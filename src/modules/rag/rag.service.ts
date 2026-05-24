import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '@modules/database';
import { QueueProducerService, ROUTING_KEY } from '@modules/queue';
import { CacheService } from '@modules/redis';
import { DocumentService } from '@modules/document';
import type { AuthenticatedUser } from '@common/interfaces';
import type { RagStatusDto } from './dto/rag-status.dto';

const RAG_REINDEX_RATE_LIMIT_TTL = 10;

@Injectable()
export class RagService {
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
    return this.findStatusFor('internal_document', documentId);
  }

  async getClinicalNoteRagStatus(noteId: string): Promise<RagStatusDto> {
    return this.findStatusFor('clinical_note', noteId);
  }

  private async findStatusFor(
    sourceType: 'internal_document' | 'clinical_note',
    sourceId: string,
  ): Promise<RagStatusDto> {
    const row = await this.prisma.baseClient.ragDocument.findFirst({
      where: { sourceType, sourceId },
      orderBy: { createdAt: 'desc' },
    });

    if (!row) {
      throw new NotFoundException('RAG status not found');
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

  async reindexClinicalNote(noteId: string): Promise<{ accepted: true }> {
    const note = await this.prisma.baseClient.clinicalNote.findFirst({
      where: { id: noteId, deletedAt: null },
      select: { id: true, status: true, parentNoteId: true },
    });

    if (!note) {
      throw new NotFoundException('Clinical note not found');
    }

    const targetId = note.parentNoteId ?? note.id;

    if (note.parentNoteId) {
      const parent = await this.prisma.baseClient.clinicalNote.findFirst({
        where: { id: targetId, deletedAt: null },
        select: { status: true },
      });
      if (!parent || parent.status !== 'signed') {
        throw new ConflictException(
          'Parent note must be signed to re-index addendum chain',
        );
      }
    } else if (note.status !== 'signed') {
      throw new ConflictException('Clinical note must be signed to re-index');
    }

    const ragRow = await this.prisma.baseClient.ragDocument.findFirst({
      where: { sourceType: 'clinical_note', sourceId: targetId },
      orderBy: { createdAt: 'desc' },
      select: { status: true },
    });

    if (ragRow && ragRow.status !== 'failed') {
      throw new ConflictException(
        'Re-index only allowed when current RAG status is failed or missing',
      );
    }

    const acquired = await this.cache.setWithNX(
      'rag:reindex:clinical_note',
      targetId,
      1,
      RAG_REINDEX_RATE_LIMIT_TTL,
    );

    if (!acquired) {
      throw new HttpException(
        'Re-index already in progress for this note',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const published = this.queue.publish(ROUTING_KEY.CLINICAL_NOTE_UPDATED, {
      sourceType: 'clinical_note',
      sourceId: targetId,
      action: 'updated',
    });

    if (!published) {
      await this.cache.del('rag:reindex:clinical_note', targetId);
      throw new ServiceUnavailableException(
        'Queue service is currently unavailable. Please retry later.',
      );
    }

    return { accepted: true };
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

    const published = this.queue.publishDocumentUpdated(documentId);

    if (!published) {
      await this.cache.del('rag:reindex', documentId);
      throw new ServiceUnavailableException(
        'Queue service is currently unavailable. Please retry later.',
      );
    }

    return { accepted: true };
  }
}
