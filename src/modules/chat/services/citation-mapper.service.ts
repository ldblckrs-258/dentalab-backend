import { Injectable } from '@nestjs/common';
import { PrismaService } from '@modules/database/prisma.service';
import type { RagSearchResult } from '@modules/rag/dto/rag-search-result.dto';
import type { CitationItem } from '../types';

const SOURCE_TYPE_LABEL: Record<string, string> = {
  internal_document: 'Document',
  procedure: 'Procedure',
  clinical_note: 'Clinical Note',
};

function toTypeLabel(sourceType: string): string {
  if (SOURCE_TYPE_LABEL[sourceType]) return SOURCE_TYPE_LABEL[sourceType];
  return sourceType
    .split('_')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : ''))
    .join(' ');
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function dedupHits(hits: RagSearchResult[]): RagSearchResult[] {
  const seen = new Set<string>();
  const out: RagSearchResult[] = [];
  for (const h of hits) {
    const key = `${h.sourceType}:${h.sourceId}:${h.parentChunkId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(h);
  }
  return out;
}

export interface MappedCitations {
  citations: CitationItem[];
  dedupedHits: RagSearchResult[];
}

@Injectable()
export class CitationMapperService {
  constructor(private readonly prisma: PrismaService) {}

  async toCitations(hits: RagSearchResult[]): Promise<MappedCitations> {
    const deduped = dedupHits(hits);

    const internalIds = Array.from(
      new Set(
        deduped
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

    const citations = deduped.map((h, i) => {
      const title = titleMap.get(h.sourceId) ?? h.filename ?? 'Document';
      const slug = h.heading ? slugify(h.heading) : '';
      const linkTo =
        h.sourceType === 'internal_document'
          ? `/documents/${h.sourceId}${slug ? `?heading=${slug}` : ''}`
          : `/${h.sourceType}/${h.sourceId}`;
      return {
        index: i + 1,
        ragDocumentId: h.ragDocumentId,
        sourceType: h.sourceType,
        sourceId: h.sourceId,
        title,
        typeLabel: toTypeLabel(h.sourceType),
        breadcrumbs: h.breadcrumbs ?? [],
        heading: h.heading,
        snippet: (h.childContent ?? '').slice(0, 300),
        score: h.score,
        linkTo,
      };
    });

    return { citations, dedupedHits: deduped };
  }
}
