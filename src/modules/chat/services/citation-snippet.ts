function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function extractSnippet(
  content: string,
  quote: string,
  cap = 200,
): string | null {
  if (!content) return null;
  const words = quote.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;

  const pattern = words.map(escapeRegExp).join('\\s+');
  let match: RegExpExecArray | null;
  try {
    match = new RegExp(pattern, 'i').exec(content);
  } catch {
    return null;
  }
  if (!match) return null;

  const rest = content.slice(match.index);
  const minEnd = match[0].length;
  const sentenceEnd = /[.!?](?=\s|$)/g;
  let end = rest.length;
  for (
    let sm = sentenceEnd.exec(rest);
    sm !== null;
    sm = sentenceEnd.exec(rest)
  ) {
    if (sm.index + 1 >= minEnd) {
      end = sm.index + 1;
      break;
    }
  }

  let snippet = rest.slice(0, end).trim();
  if (snippet.length > cap) {
    let cut = snippet.slice(0, cap);
    const lastSpace = cut.lastIndexOf(' ');
    if (lastSpace > 0) cut = cut.slice(0, lastSpace);
    snippet = `${cut.trimEnd()}…`;
  }
  return snippet;
}
