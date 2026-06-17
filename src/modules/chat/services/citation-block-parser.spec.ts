import {
  splitAnswerAndAnchors,
  stripAnchorBlock,
} from './citation-block-parser';

describe('splitAnswerAndAnchors', () => {
  it('splits prose from a clean trailing anchor block with a breadcrumb path', () => {
    const full =
      'Anesthesia is required [1].\n<<<CITES>>>\n[{"n":1,"quote":"Anesthesia is required","breadcrumbs":["Surgery","Anesthesia"]}]';
    const { prose, anchors } = splitAnswerAndAnchors(full);
    expect(prose).toBe('Anesthesia is required [1].');
    expect(anchors).toEqual([
      {
        n: 1,
        quote: 'Anesthesia is required',
        breadcrumbs: ['Surgery', 'Anesthesia'],
      },
    ]);
  });

  it('returns full text and no anchors when sentinel absent', () => {
    const { prose, anchors } = splitAnswerAndAnchors('Just an answer.');
    expect(prose).toBe('Just an answer.');
    expect(anchors).toEqual([]);
  });

  it('tolerates a code-fenced JSON block', () => {
    const full =
      'Answer [2].\n<<<CITES>>>\n```json\n[{"n":2,"quote":"the exact words"}]\n```';
    const { anchors } = splitAnswerAndAnchors(full);
    expect(anchors).toEqual([{ n: 2, quote: 'the exact words' }]);
  });

  it('ignores trailing prose after the JSON array', () => {
    const full =
      'A [1].\n<<<CITES>>>\n[{"n":1,"quote":"the exact words"}] thanks!';
    const { anchors } = splitAnswerAndAnchors(full);
    expect(anchors).toEqual([{ n: 1, quote: 'the exact words' }]);
  });

  it('returns empty anchors on malformed JSON', () => {
    const full = 'A.\n<<<CITES>>>\n[{"n":1,"quote": broken]';
    const { prose, anchors } = splitAnswerAndAnchors(full);
    expect(prose).toBe('A.');
    expect(anchors).toEqual([]);
  });

  it('drops entries missing n or quote, coerces string n', () => {
    const full =
      'A.\n<<<CITES>>>\n[{"n":"3","quote":"good one"},{"quote":"no n"},{"n":4},{"n":0,"quote":"bad index"}]';
    const { anchors } = splitAnswerAndAnchors(full);
    expect(anchors).toEqual([{ n: 3, quote: 'good one' }]);
  });

  it('keeps only non-empty string breadcrumbs, omits empty path', () => {
    const withJunk =
      'A.\n<<<CITES>>>\n[{"n":1,"quote":"x","breadcrumbs":["H1","  ",5,"H2"]}]';
    expect(splitAnswerAndAnchors(withJunk).anchors).toEqual([
      { n: 1, quote: 'x', breadcrumbs: ['H1', 'H2'] },
    ]);

    const empty = 'A.\n<<<CITES>>>\n[{"n":1,"quote":"x","breadcrumbs":[]}]';
    expect(splitAnswerAndAnchors(empty).anchors).toEqual([
      { n: 1, quote: 'x' },
    ]);
  });

  it('parses multiple anchors', () => {
    const full =
      'A [1] B [2].\n<<<CITES>>>\n[{"n":1,"quote":"alpha"},{"n":2,"quote":"beta"}]';
    const { anchors } = splitAnswerAndAnchors(full);
    expect(anchors).toHaveLength(2);
    expect(anchors.map((a) => a.n)).toEqual([1, 2]);
  });
});

describe('stripAnchorBlock', () => {
  it('strips a complete trailing block', () => {
    expect(
      stripAnchorBlock('Prose text.\n<<<CITES>>>\n[{"n":1,"quote":"x"}]'),
    ).toBe('Prose text.');
  });

  it('strips a partial sentinel suffix (abort mid-sentinel)', () => {
    expect(stripAnchorBlock('Prose text.\n<<<CI')).toBe('Prose text.');
    expect(stripAnchorBlock('Prose text.\n<<<CITES>>')).toBe('Prose text.');
  });

  it('returns full text unchanged when no sentinel present', () => {
    expect(stripAnchorBlock('Just an answer.')).toBe('Just an answer.');
  });

  it('does not over-strip legitimate prose with angle brackets', () => {
    expect(stripAnchorBlock('compare a < b here')).toBe('compare a < b here');
    expect(stripAnchorBlock('use the << operator')).toBe('use the << operator');
  });
});
