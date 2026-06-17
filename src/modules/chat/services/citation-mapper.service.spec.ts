import { Test } from '@nestjs/testing';
import { PrismaService } from '@modules/database/prisma.service';
import { CitationMapperService } from './citation-mapper.service';
import type { RagSearchResult } from '@modules/rag/dto/rag-search-result.dto';
import type { CitationItem } from '../types';

function makeHit(over: Partial<RagSearchResult> = {}): RagSearchResult {
  return {
    childChunkId: 'c1',
    parentChunkId: 'p1',
    ragDocumentId: 'r1',
    sourceType: 'internal_document',
    sourceId: 'doc-1',
    filename: null,
    childContent:
      'gingivitis is gum inflammation. clinical signs include redness.',
    parentContent: 'long parent',
    score: 0.9,
    metadata: null,
    heading: 'Clinical Signs',
    headingLevel: 2,
    breadcrumbs: [],
    ...over,
  };
}

describe('CitationMapperService', () => {
  let service: CitationMapperService;
  let findMany: jest.Mock;

  beforeEach(async () => {
    findMany = jest.fn().mockResolvedValue([
      { id: 'doc-1', title: 'Gingivitis SOP' },
      { id: 'doc-2', title: 'Periodontitis Guidelines' },
    ]);

    const prisma = {
      client: {
        internalDocument: { findMany },
      },
    } as unknown as PrismaService;

    const module = await Test.createTestingModule({
      providers: [
        CitationMapperService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(CitationMapperService);
  });

  it('maps RAG hit to citation with title, snippet, linkTo, index', async () => {
    const { citations: out } = await service.toCitations([
      makeHit({ sourceId: 'doc-1', heading: 'Clinical Signs' }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe('Gingivitis SOP');
    expect(out[0].linkTo).toBe('/documents/doc-1?heading=clinical-signs');
    expect(out[0].snippet.length).toBeLessThanOrEqual(300);
    expect(out[0].index).toBe(1);
    expect(out[0].typeLabel).toBe('Document');
    expect(out[0].ragDocumentId).toBe('r1');
  });

  it('handles hit without heading', async () => {
    const { citations: out } = await service.toCitations([
      makeHit({ sourceId: 'doc-2', heading: null }),
    ]);
    expect(out[0].linkTo).toBe('/documents/doc-2');
  });

  it('falls back to filename when document missing', async () => {
    findMany.mockResolvedValue([]);
    const { citations: out } = await service.toCitations([
      makeHit({ sourceId: 'missing', filename: 'fallback.pdf' }),
    ]);
    expect(out[0].title).toBe('fallback.pdf');
  });

  it('deduplicates internalDocument id lookups', async () => {
    await service.toCitations([
      makeHit({ sourceId: 'doc-1', parentChunkId: 'p-a' }),
      makeHit({ sourceId: 'doc-1', parentChunkId: 'p-b', heading: 'Other' }),
      makeHit({ sourceId: 'doc-2', parentChunkId: 'p-c' }),
    ]);
    expect(findMany).toHaveBeenCalledTimes(1);
    const arg = findMany.mock.calls[0][0];
    expect(arg.where.id.in.sort()).toEqual(['doc-1', 'doc-2']);
  });

  it('dedups hits sharing (sourceType, sourceId, parentChunkId) — collapses to one citation', async () => {
    const { citations: out } = await service.toCitations([
      makeHit({ childChunkId: 'c-a', parentChunkId: 'p1' }),
      makeHit({ childChunkId: 'c-b', parentChunkId: 'p1' }),
      makeHit({ childChunkId: 'c-c', parentChunkId: 'p2', sourceId: 'doc-2' }),
    ]);
    expect(out).toHaveLength(2);
    expect(out.map((c) => c.index)).toEqual([1, 2]);
  });

  it('assigns 1-based contiguous indexes preserving rank order', async () => {
    const { citations: out } = await service.toCitations([
      makeHit({ parentChunkId: 'pA', sourceId: 'doc-1' }),
      makeHit({ parentChunkId: 'pB', sourceId: 'doc-2' }),
    ]);
    expect(out[0].index).toBe(1);
    expect(out[1].index).toBe(2);
  });

  it('typeLabel uses map for known types and titlecase fallback for unknown', async () => {
    findMany.mockResolvedValue([]);
    const { citations: out } = await service.toCitations([
      makeHit({ sourceType: 'procedure', sourceId: 'proc-1' }),
      makeHit({
        sourceType: 'custom_resource_kind',
        sourceId: 'cust-1',
        parentChunkId: 'p9',
      }),
    ]);
    expect(out[0].typeLabel).toBe('Procedure');
    expect(out[1].typeLabel).toBe('Custom Resource Kind');
  });

  it('breadcrumbs from RagSearchResult propagate through', async () => {
    const { citations: out } = await service.toCitations([
      makeHit({
        sourceId: 'doc-1',
        breadcrumbs: ['Chapter 1', 'Section A'],
      }),
    ]);
    expect(out[0].breadcrumbs).toEqual(['Chapter 1', 'Section A']);
  });

  it('snippet truncated to 300 chars', async () => {
    const long = 'a'.repeat(500);
    const { citations: out } = await service.toCitations([
      makeHit({ sourceId: 'doc-1', childContent: long }),
    ]);
    expect(out[0].snippet.length).toBe(300);
  });

  it('empty hits → empty arrays (not error)', async () => {
    const { citations, dedupedHits } = await service.toCitations([]);
    expect(citations).toEqual([]);
    expect(dedupedHits).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('stamps pageStart/pageEnd when hit carries a page range', async () => {
    const { citations: out } = await service.toCitations([
      makeHit({ sourceId: 'doc-1', pageStart: 3, pageEnd: 4 }),
    ]);
    expect(out[0].pageStart).toBe(3);
    expect(out[0].pageEnd).toBe(4);
    expect(out[0].title).toBe('Gingivitis SOP');
  });

  it('defaults pageEnd to pageStart when only start present', async () => {
    const { citations: out } = await service.toCitations([
      makeHit({ sourceId: 'doc-1', pageStart: 2, pageEnd: undefined }),
    ]);
    expect(out[0].pageStart).toBe(2);
    expect(out[0].pageEnd).toBe(2);
  });

  it('omits page fields when hit has no page', async () => {
    const { citations: out } = await service.toCitations([
      makeHit({ sourceId: 'doc-1' }),
    ]);
    expect(out[0].pageStart).toBeUndefined();
    expect(out[0].pageEnd).toBeUndefined();
  });

  it('returns dedupedHits aligned 1:1 with citations after dedup', async () => {
    const { citations, dedupedHits } = await service.toCitations([
      makeHit({ childChunkId: 'c-a', parentChunkId: 'p1' }),
      makeHit({ childChunkId: 'c-b', parentChunkId: 'p1' }),
      makeHit({ childChunkId: 'c-c', parentChunkId: 'p2', sourceId: 'doc-2' }),
    ]);
    expect(dedupedHits).toHaveLength(citations.length);
    expect(dedupedHits[0].parentChunkId).toBe('p1');
    expect(dedupedHits[1].parentChunkId).toBe('p2');
    expect(citations[0].sourceId).toBe(dedupedHits[0].sourceId);
    expect(citations[1].sourceId).toBe(dedupedHits[1].sourceId);
  });
});

function baseCitation(over: Partial<CitationItem> = {}): CitationItem {
  return {
    index: 1,
    ragDocumentId: 'r1',
    sourceType: 'internal_document',
    sourceId: 'doc-1',
    title: 'Doc 1',
    typeLabel: 'Document',
    breadcrumbs: [],
    heading: null,
    snippet: 'OLD SNIPPET that was a blind slice of the chunk content',
    score: 0.9,
    linkTo: '/documents/doc-1',
    ...over,
  };
}

describe('CitationMapperService.refineCitations', () => {
  let service: CitationMapperService;

  beforeEach(async () => {
    const prisma = {
      client: { internalDocument: { findMany: jest.fn() } },
    } as unknown as PrismaService;
    const module = await Test.createTestingModule({
      providers: [
        CitationMapperService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(CitationMapperService);
  });

  it('replaces snippet with the verbatim passage located in childContent', () => {
    const hit = makeHit({
      childContent:
        'Preamble text. Composite resin must cure for twenty seconds under the lamp. Trailing.',
    });
    const out = service.refineCitations(
      [baseCitation()],
      [hit],
      [{ n: 1, quote: 'Composite resin must cure' }],
    );
    expect(out[0].snippet).toBe(
      'Composite resin must cure for twenty seconds under the lamp.',
    );
  });

  it('falls back to parentContent when quote is not in childContent', () => {
    const hit = makeHit({
      childContent: 'unrelated child text.',
      parentContent: 'The recall interval is six months for low-risk adults.',
    });
    const out = service.refineCitations(
      [baseCitation()],
      [hit],
      [{ n: 1, quote: 'recall interval is six months' }],
    );
    expect(out[0].snippet).toContain('recall interval is six months');
  });

  it('preserves page fields and linkTo when refining', () => {
    const hit = makeHit({ childContent: 'Alpha beta gamma delta epsilon.' });
    const out = service.refineCitations(
      [
        baseCitation({
          pageStart: 3,
          pageEnd: 4,
          linkTo: '/documents/doc-1?heading=x',
        }),
      ],
      [hit],
      [{ n: 1, quote: 'Alpha beta gamma' }],
    );
    expect(out[0].pageStart).toBe(3);
    expect(out[0].pageEnd).toBe(4);
    expect(out[0].linkTo).toBe('/documents/doc-1?heading=x');
    expect(out[0].snippet).toBe('Alpha beta gamma delta epsilon.');
  });

  it('overrides a wrong metadata heading with a content-grounded section and clears noisy breadcrumbs', () => {
    const hit = makeHit({
      childContent:
        'II. Principles for choosing disinfectant\nApply fluoride varnish quarterly for high-risk patients.',
      breadcrumbs: ['REGULATION', 'Storage'],
      heading: 'Mismatched Heading',
    });
    const out = service.refineCitations(
      [
        baseCitation({
          breadcrumbs: ['REGULATION', 'Storage'],
          heading: 'Mismatched Heading',
        }),
      ],
      [hit],
      [
        {
          n: 1,
          quote: 'Apply fluoride varnish',
          section: 'II. Principles for choosing disinfectant',
        },
      ],
    );
    expect(out[0].heading).toBe('II. Principles for choosing disinfectant');
    expect(out[0].breadcrumbs).toEqual([]);
  });

  it('ignores a section not present in the chunk content (anti-fabrication)', () => {
    const hit = makeHit({
      childContent: 'Some real content sentence here.',
      breadcrumbs: ['Chapter 1'],
      heading: 'Intro',
    });
    const out = service.refineCitations(
      [baseCitation({ breadcrumbs: ['Chapter 1'], heading: 'Intro' })],
      [hit],
      [{ n: 1, quote: 'Some real content', section: 'Fabricated Section' }],
    );
    expect(out[0].heading).toBe('Intro');
    expect(out[0].breadcrumbs).toEqual(['Chapter 1']);
  });

  it('leaves a citation unchanged when the quote is not found', () => {
    const hit = makeHit({ childContent: 'totally different content.' });
    const base = baseCitation();
    const out = service.refineCitations(
      [base],
      [hit],
      [{ n: 1, quote: 'phrase absent from the chunk' }],
    );
    expect(out[0].snippet).toBe(base.snippet);
  });

  it('leaves citations without a matching anchor unchanged', () => {
    const base = baseCitation();
    const out = service.refineCitations([base], [makeHit()], []);
    expect(out[0]).toBe(base);
  });
});
