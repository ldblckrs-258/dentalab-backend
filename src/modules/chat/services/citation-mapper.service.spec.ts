import { Test } from '@nestjs/testing';
import { PrismaService } from '@modules/database/prisma.service';
import { CitationMapperService } from './citation-mapper.service';
import type { RagSearchResult } from '@modules/rag/dto/rag-search-result.dto';

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

  it('maps RAG hit to citation with title, snippet, linkTo', async () => {
    const out = await service.toCitations([
      makeHit({ sourceId: 'doc-1', heading: 'Clinical Signs' }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe('Gingivitis SOP');
    expect(out[0].linkTo).toBe('/documents/doc-1?heading=clinical-signs');
    expect(out[0].snippet.length).toBeLessThanOrEqual(200);
  });

  it('handles hit without heading', async () => {
    const out = await service.toCitations([
      makeHit({ sourceId: 'doc-2', heading: null }),
    ]);
    expect(out[0].linkTo).toBe('/documents/doc-2');
  });

  it('falls back to filename when document missing', async () => {
    findMany.mockResolvedValue([]);
    const out = await service.toCitations([
      makeHit({ sourceId: 'missing', filename: 'fallback.pdf' }),
    ]);
    expect(out[0].title).toBe('fallback.pdf');
  });

  it('deduplicates internalDocument id lookups', async () => {
    await service.toCitations([
      makeHit({ sourceId: 'doc-1' }),
      makeHit({ sourceId: 'doc-1', heading: 'Other' }),
      makeHit({ sourceId: 'doc-2' }),
    ]);
    expect(findMany).toHaveBeenCalledTimes(1);
    const arg = findMany.mock.calls[0][0];
    expect(arg.where.id.in.sort()).toEqual(['doc-1', 'doc-2']);
  });
});
