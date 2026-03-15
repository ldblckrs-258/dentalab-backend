import { buildDynamicFilters } from './filter-builder';
import type { FilterConfig } from './filter-builder';

describe('buildDynamicFilters', () => {
  const config: FilterConfig = {
    allowedFields: ['status', 'name', 'createdAt', 'type'],
  };

  it('should handle equality filters', () => {
    const query = { status: 'active' };
    expect(buildDynamicFilters(query, config)).toEqual({ status: 'active' });
  });

  it('should ignore fields not in allowedFields', () => {
    const query = { status: 'active', hackerField: 'drop table' };
    const result = buildDynamicFilters(query, config);
    expect(result).toEqual({ status: 'active' });
    expect(result).not.toHaveProperty('hackerField');
  });

  it('should handle bracket-style range filters', () => {
    const query = {
      'createdAt[gte]': '2024-01-01',
      'createdAt[lte]': '2024-12-31',
    };
    expect(buildDynamicFilters(query, config)).toEqual({
      createdAt: { gte: '2024-01-01', lte: '2024-12-31' },
    });
  });

  it('should handle double-underscore range filters', () => {
    const query = {
      createdAt__gt: '2024-01-01',
      createdAt__lt: '2024-12-31',
    };
    expect(buildDynamicFilters(query, config)).toEqual({
      createdAt: { gt: '2024-01-01', lt: '2024-12-31' },
    });
  });

  it('should handle contains filter', () => {
    const query = { 'name[contains]': 'nguyen' };
    expect(buildDynamicFilters(query, config)).toEqual({
      name: { contains: 'nguyen', mode: 'insensitive' },
    });
  });

  it('should handle double-underscore contains filter', () => {
    const query = { name__contains: 'nguyen' };
    expect(buildDynamicFilters(query, config)).toEqual({
      name: { contains: 'nguyen', mode: 'insensitive' },
    });
  });

  it('should handle in filter with comma-separated values', () => {
    const query = { 'status[in]': 'active, inactive, pending' };
    expect(buildDynamicFilters(query, config)).toEqual({
      status: { in: ['active', 'inactive', 'pending'] },
    });
  });

  it('should return empty object when no matching filters', () => {
    const query = { unknownField: 'value' };
    expect(buildDynamicFilters(query, config)).toEqual({});
  });

  it('should prioritize equality over range filters', () => {
    const query = { status: 'active', 'status[gte]': 'something' };
    expect(buildDynamicFilters(query, config)).toEqual({ status: 'active' });
  });
});
