import { PrismaService } from '@modules/database/prisma.service';
import type { RagSearchResult } from '@modules/rag/dto/rag-search-result.dto';
import { Injectable } from '@nestjs/common';
import type { CitationItem } from '../types';
import type { CitationAnchor } from './citation-block-parser';
import { extractSnippet } from './citation-snippet';

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

function sectionInContent(section: string, hit: RagSearchResult): boolean {
  const needle = section.toLowerCase().replace(/\s+/g, ' ').trim();
  if (needle.length < 3 || needle.length > 120) return false;
  const hay = `${hit.childContent ?? ''}\n${hit.parentContent ?? ''}`
    .toLowerCase()
    .replace(/\s+/g, ' ');
  return hay.includes(needle);
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
    const clinicalNoteIds = Array.from(
      new Set(
        deduped
          .filter((h) => h.sourceType === 'clinical_note')
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

    const notes = clinicalNoteIds.length
      ? await this.prisma.client.clinicalNote.findMany({
          where: { id: { in: clinicalNoteIds } },
          select: {
            id: true,
            signedAt: true,
            patient: { select: { id: true, firstName: true, lastName: true } },
          },
        })
      : [];
    const noteMap = new Map(
      notes.map((n) => {
        const fn = n.patient?.firstName?.trim() ?? '';
        const ln = n.patient?.lastName?.trim() ?? '';
        const patientName = [fn, ln].filter(Boolean).join(' ') || null;
        return [
          n.id,
          {
            patientId: n.patient?.id ?? null,
            patientName,
            signedAt: n.signedAt ? n.signedAt.toISOString() : null,
          },
        ];
      }),
    );

    const citations = deduped.map((h, i) => {
      const noteMeta = noteMap.get(h.sourceId);
      const title =
        titleMap.get(h.sourceId) ??
        noteMeta?.patientName ??
        h.filename ??
        'Document';
      const slug = h.heading ? slugify(h.heading) : '';
      const linkTo =
        h.sourceType === 'internal_document'
          ? `/documents/${h.sourceId}${slug ? `?heading=${slug}` : ''}`
          : h.sourceType === 'clinical_note'
            ? noteMeta?.patientId
              ? `/patients/${noteMeta.patientId}?noteId=${h.sourceId}`
              : `/clinical-notes/${h.sourceId}`
            : `/${h.sourceType}/${h.sourceId}`;
      const item: CitationItem = {
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
      if (typeof h.pageStart === 'number') {
        item.pageStart = h.pageStart;
        item.pageEnd = typeof h.pageEnd === 'number' ? h.pageEnd : h.pageStart;
      }
      if (h.sourceType === 'clinical_note' && noteMeta) {
        if (noteMeta.patientName) item.patientName = noteMeta.patientName;
        if (noteMeta.signedAt) item.signedAt = noteMeta.signedAt;
      }
      return item;
    });

    return { citations, dedupedHits: deduped };
  }

  refineCitations(
    base: CitationItem[],
    hits: RagSearchResult[],
    anchors: CitationAnchor[],
  ): CitationItem[] {
    if (anchors.length === 0) return base;
    const byN = new Map<number, CitationAnchor[]>();
    for (const a of anchors) {
      const group = byN.get(a.n) ?? [];
      group.push(a);
      byN.set(a.n, group);
    }

    return base.map((c) => {
      const group = byN.get(c.index);
      const hit = hits[c.index - 1];
      if (!group || !hit) return c;

      const passages: string[] = [];
      for (const a of group) {
        const text =
          extractSnippet(hit.childContent ?? '', a.quote) ??
          extractSnippet(hit.parentContent ?? '', a.quote);
        if (text && !passages.includes(text)) passages.push(text);
      }
      const snippet = passages.length > 0 ? passages.join(' […] ') : null;

      let breadcrumbs = c.breadcrumbs;
      let heading = c.heading;
      for (const a of group) {
        if (!a.breadcrumbs || a.breadcrumbs.length === 0) continue;
        const path = a.breadcrumbs.filter((b) => sectionInContent(b, hit));
        if (path.length > 0) {
          breadcrumbs = path.slice(0, -1);
          heading = path[path.length - 1];
          break;
        }
      }

      if (!snippet && heading === c.heading) return c;
      return {
        ...c,
        ...(snippet ? { snippet } : {}),
        breadcrumbs,
        heading,
      };
    });
  }
}
