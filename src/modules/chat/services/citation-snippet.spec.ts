import { extractSnippet } from './citation-snippet';

describe('extractSnippet', () => {
  it('returns the verbatim passage starting at the quote, sentence-bounded', () => {
    const content =
      'Intro line. Anesthesia is required for surgical extractions per protocol. Next sentence here.';
    const out = extractSnippet(content, 'Anesthesia is required');
    expect(out).toBe(
      'Anesthesia is required for surgical extractions per protocol.',
    );
  });

  it('matches case-insensitively and across collapsed whitespace', () => {
    const content = 'The   QUICK\nbrown fox jumps over the lazy dog and rests.';
    const out = extractSnippet(content, 'quick brown fox');
    expect(out?.toLowerCase().startsWith('quick')).toBe(true);
    expect(out).toContain('brown fox');
  });

  it('returns null when the quote is not present', () => {
    expect(extractSnippet('some content here.', 'totally absent phrase')).toBe(
      null,
    );
  });

  it('returns null for empty content or empty quote', () => {
    expect(extractSnippet('', 'anything')).toBe(null);
    expect(extractSnippet('content', '   ')).toBe(null);
  });

  it('truncates to <=200 chars + ellipsis when no early sentence end', () => {
    const longSentence = `Anesthesia ${'word '.repeat(120)}end`;
    const out = extractSnippet(longSentence, 'Anesthesia');
    expect(out).not.toBeNull();
    expect(out!.length).toBeLessThanOrEqual(201);
    expect(out!.endsWith('…')).toBe(true);
  });

  it('does not append ellipsis for a clean short sentence', () => {
    const content =
      'Filler sentence one here. The dosage is two hundred milligrams daily for adults. More text.';
    const out = extractSnippet(content, 'The dosage is two hundred');
    expect(out).toBe('The dosage is two hundred milligrams daily for adults.');
    expect(out!.endsWith('…')).toBe(false);
  });

  it('handles quotes containing regex-special characters', () => {
    const content = 'Use form (A-1) for intake. Then proceed.';
    const out = extractSnippet(content, 'form (A-1)');
    expect(out).toContain('form (A-1)');
  });
});
