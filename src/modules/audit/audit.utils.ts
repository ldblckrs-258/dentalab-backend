const ALWAYS_IGNORED = new Set([
  'updated_at',
  'updatedAt',
  'created_at',
  'createdAt',
  'search_vector',
  'searchVector',
  'embedding',
]);

export function pairedDiff(
  oldData: Record<string, unknown> | null | undefined,
  newData: Record<string, unknown> | null | undefined,
  ignoredExtra: Iterable<string> = [],
): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const ignored = new Set([...ALWAYS_IGNORED, ...ignoredExtra]);
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};

  if (oldData == null || newData == null) return { before, after };
  for (const k of Object.keys(oldData)) {
    if (ignored.has(k)) continue;
    if (!(k in newData)) continue;
    const o = oldData[k];
    const n = newData[k];
    if (JSON.stringify(o) !== JSON.stringify(n)) {
      before[k] = o;
      after[k] = n;
    }
  }
  return { before, after };
}

export function isPairedDiffEmpty(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): boolean {
  return !Object.keys(before).length && !Object.keys(after).length;
}
