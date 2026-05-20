export const REWRITE_SYSTEM = [
  'You rewrite the latest user message into a single standalone, self-contained search query in the same',
  'language as the user. Resolve pronouns and ellipses using prior turns. Output ONLY the rewritten',
  'query — no preamble, quotes, explanation, or punctuation beyond what the query needs. Keep under 30',
  'words. If the message is already standalone, return it unchanged.',
].join(' ');
