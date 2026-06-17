export interface CitationAnchor {
  n: number;
  quote: string;
  section?: string;
}

const SENTINEL = '<<<CITES>>>';

export function splitAnswerAndAnchors(full: string): {
  prose: string;
  anchors: CitationAnchor[];
} {
  const idx = full.indexOf(SENTINEL);
  if (idx === -1) return { prose: full, anchors: [] };
  const prose = full.slice(0, idx).trimEnd();
  const anchors = parseAnchors(full.slice(idx + SENTINEL.length));
  return { prose, anchors };
}

function parseAnchors(tail: string): CitationAnchor[] {
  const start = tail.indexOf('[');
  const end = tail.lastIndexOf(']');
  if (start === -1 || end <= start) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(tail.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const out: CitationAnchor[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const n =
      typeof rec.n === 'number'
        ? rec.n
        : typeof rec.n === 'string'
          ? Number(rec.n)
          : NaN;
    const quote = typeof rec.quote === 'string' ? rec.quote.trim() : '';
    if (!Number.isInteger(n) || n < 1 || quote.length === 0) continue;
    const section =
      typeof rec.section === 'string' && rec.section.trim().length > 0
        ? rec.section.trim()
        : undefined;
    out.push(section ? { n, quote, section } : { n, quote });
  }
  return out;
}

export function stripAnchorBlock(full: string): string {
  const idx = full.indexOf(SENTINEL);
  if (idx !== -1) return full.slice(0, idx).trimEnd();
  for (let len = SENTINEL.length - 1; len >= 3; len--) {
    if (full.endsWith(SENTINEL.slice(0, len))) {
      return full.slice(0, full.length - len).trimEnd();
    }
  }
  return full;
}

export { SENTINEL };
