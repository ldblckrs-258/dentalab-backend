import { Injectable } from '@nestjs/common';
import { PrismaService } from '@modules/database/prisma.service';
import type { RagSearchResult } from '@modules/rag/dto/rag-search-result.dto';
import type { CitationItem } from '../types';

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

@Injectable()
export class CitationMapperService {
  constructor(private readonly prisma: PrismaService) {}

  async toCitations(hits: RagSearchResult[]): Promise<CitationItem[]> {
    const internalIds = Array.from(
      new Set(
        hits
          .filter((h) => h.sourceType === 'internal_document')
          .map((h) => h.sourceId),
      ),
    );

    const docs = internalIds.length
      ? await this.prisma.client.internalDocument.findMany({
          where: { id: { in: internalIds } },
          select: { id: true, title: true },
        })
      : [];
    const titleMap = new Map(docs.map((d) => [d.id, d.title]));

    return hits.map((h) => {
      const title = titleMap.get(h.sourceId) ?? h.filename ?? 'Document';
      const slug = h.heading ? slugify(h.heading) : '';
      const linkTo =
        h.sourceType === 'internal_document'
          ? `/documents/${h.sourceId}${slug ? `?heading=${slug}` : ''}`
          : `/${h.sourceType}/${h.sourceId}`;
      return {
        sourceId: h.sourceId,
        title,
        heading: h.heading,
        snippet: (h.childContent ?? '').slice(0, 200),
        score: h.score,
        linkTo,
      };
    });
  }
}
