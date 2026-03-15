export interface FilterConfig {
  allowedFields: string[];
}

export function buildDynamicFilters(
  query: Record<string, unknown>,
  config: FilterConfig,
): Record<string, unknown> {
  const where: Record<string, unknown> = {};

  for (const field of config.allowedFields) {
    // Equality: ?status=active
    if (query[field] !== undefined) {
      where[field] = query[field];
      continue;
    }

    // Range: ?createdAt[gte]=2024-01-01
    const gte = query[`${field}[gte]`] ?? query[`${field}__gte`];
    const lte = query[`${field}[lte]`] ?? query[`${field}__lte`];
    const gt = query[`${field}[gt]`] ?? query[`${field}__gt`];
    const lt = query[`${field}[lt]`] ?? query[`${field}__lt`];

    if (
      gte !== undefined ||
      lte !== undefined ||
      gt !== undefined ||
      lt !== undefined
    ) {
      const rangeFilter: Record<string, unknown> = {};
      if (gte !== undefined) rangeFilter.gte = gte;
      if (lte !== undefined) rangeFilter.lte = lte;
      if (gt !== undefined) rangeFilter.gt = gt;
      if (lt !== undefined) rangeFilter.lt = lt;
      where[field] = rangeFilter;
      continue;
    }

    // Contains: ?name[contains]=nguyen
    const contains = query[`${field}[contains]`] ?? query[`${field}__contains`];
    if (contains !== undefined) {
      where[field] = { contains, mode: 'insensitive' };
      continue;
    }

    // In: ?status[in]=scheduled,confirmed
    const inValue = query[`${field}[in]`] ?? query[`${field}__in`];
    if (typeof inValue === 'string') {
      where[field] = { in: inValue.split(',').map((v: string) => v.trim()) };
    }
  }

  return where;
}
