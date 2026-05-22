import { Injectable } from '@nestjs/common';
import { RagSearchService } from '@modules/rag/rag-search.service';
import type { RagSearchResult } from '@modules/rag/dto/rag-search-result.dto';

@Injectable()
export class ChatRagService {
  constructor(private readonly rag: RagSearchService) {}

  async query(
    rewrittenText: string,
    userId: string,
    topK: number | null,
  ): Promise<RagSearchResult[]> {
    const syntheticUser = {
      id: userId,
      email: '',
      fullName: '',
      isActive: true,
    };
    const result = await this.rag.search(
      {
        query: rewrittenText,
        topK: topK ?? 5,
        sourceTypes: ['internal_document', 'clinical_note'],
      },
      syntheticUser,
    );
    return result.results;
  }
}
