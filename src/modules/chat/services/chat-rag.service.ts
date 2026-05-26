import { Injectable } from '@nestjs/common';
import { RagSearchService } from '@modules/rag/rag-search.service';
import type { RagSearchResult } from '@modules/rag/dto/rag-search-result.dto';
import type { AuthenticatedUser } from '@common/interfaces';
import type { EffectiveScope } from './chat-scope-validator.service';

@Injectable()
export class ChatRagService {
  constructor(private readonly rag: RagSearchService) {}

  async query(
    rewrittenText: string,
    user: AuthenticatedUser,
    topK: number | null,
    effectiveScope: EffectiveScope | null,
  ): Promise<RagSearchResult[]> {
    const patientId =
      effectiveScope?.type === 'patient' && effectiveScope.patientId
        ? effectiveScope.patientId
        : undefined;
    const ragDocumentIds =
      effectiveScope?.type === 'documents' &&
      effectiveScope.ragDocumentIds &&
      effectiveScope.ragDocumentIds.length > 0
        ? effectiveScope.ragDocumentIds
        : undefined;

    const result = await this.rag.search(
      {
        query: rewrittenText,
        topK: topK ?? 5,
        sourceTypes: ['internal_document', 'clinical_note'],
        patientId,
        ragDocumentIds,
      },
      user,
    );
    return result.results;
  }
}
