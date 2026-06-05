import { extractPageRange } from './rag-search-result.dto';

describe('extractPageRange', () => {
  it('reads page_start and page_end from metadata', () => {
    expect(extractPageRange({ page_start: 3, page_end: 4 })).toEqual({
      pageStart: 3,
      pageEnd: 4,
    });
  });

  it('defaults pageEnd to pageStart when page_end absent', () => {
    expect(extractPageRange({ page_start: 2 })).toEqual({
      pageStart: 2,
      pageEnd: 2,
    });
  });

  it('returns empty when page_start missing or non-numeric', () => {
    expect(extractPageRange({})).toEqual({});
    expect(extractPageRange(null)).toEqual({});
    expect(extractPageRange({ page_start: '3' })).toEqual({});
  });
});
