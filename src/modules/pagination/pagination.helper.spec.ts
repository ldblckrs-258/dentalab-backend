import { BadRequestException } from '@nestjs/common';
import { buildPrismaQuery, buildPaginatedResponse } from './pagination.helper';
import type { PaginationQueryDto } from './pagination-query.dto';

describe('pagination.helper', () => {
  describe('buildPrismaQuery', () => {
    const allowedSortFields = ['name', 'createdAt', 'email'];

    it('should use defaults when no params provided', () => {
      const dto: PaginationQueryDto = {};
      const result = buildPrismaQuery(dto, allowedSortFields);
      expect(result).toEqual({
        take: 20,
        skip: 0,
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should calculate skip from page and limit', () => {
      const dto: PaginationQueryDto = { page: 3, limit: 10 };
      const result = buildPrismaQuery(dto, allowedSortFields);
      expect(result.skip).toBe(20);
      expect(result.take).toBe(10);
    });

    it('should handle cursor-based pagination', () => {
      const dto: PaginationQueryDto = { cursor: 'some-uuid', limit: 5 };
      const result = buildPrismaQuery(dto, allowedSortFields);
      expect(result.cursor).toEqual({ id: 'some-uuid' });
      expect(result.skip).toBe(1);
      expect(result.take).toBe(5);
    });

    it('should apply custom sort field and order', () => {
      const dto: PaginationQueryDto = { sortBy: 'name', sortOrder: 'asc' };
      const result = buildPrismaQuery(dto, allowedSortFields);
      expect(result.orderBy).toEqual({ name: 'asc' });
    });

    it('should default sortOrder to desc', () => {
      const dto: PaginationQueryDto = { sortBy: 'email' };
      const result = buildPrismaQuery(dto, allowedSortFields);
      expect(result.orderBy).toEqual({ email: 'desc' });
    });

    it('should use custom default sort when provided', () => {
      const dto: PaginationQueryDto = {};
      const result = buildPrismaQuery(dto, allowedSortFields, { name: 'asc' });
      expect(result.orderBy).toEqual({ name: 'asc' });
    });

    it('should throw for invalid sort field', () => {
      const dto: PaginationQueryDto = { sortBy: 'invalid_field' };
      expect(() => buildPrismaQuery(dto, allowedSortFields)).toThrow(
        BadRequestException,
      );
    });
  });

  describe('buildPaginatedResponse', () => {
    it('should build correct pagination metadata', () => {
      const data = [{ id: '1' }, { id: '2' }];
      const dto: PaginationQueryDto = { page: 1, limit: 2 };
      const result = buildPaginatedResponse(data, 5, dto);

      expect(result.data).toEqual(data);
      expect(result.meta).toEqual({
        total: 5,
        page: 1,
        limit: 2,
        totalPages: 3,
        hasNextPage: true,
        hasPreviousPage: false,
      });
    });

    it('should detect last page correctly', () => {
      const dto: PaginationQueryDto = { page: 3, limit: 2 };
      const result = buildPaginatedResponse([], 5, dto);

      expect(result.meta.hasNextPage).toBe(false);
      expect(result.meta.hasPreviousPage).toBe(true);
    });

    it('should include nextCursor for cursor-based pagination', () => {
      const data = [{ id: 'a' }, { id: 'b' }];
      const dto: PaginationQueryDto = { cursor: 'prev-cursor', limit: 2 };
      const result = buildPaginatedResponse(data, 10, dto);

      expect(result.meta.nextCursor).toBe('b');
    });

    it('should handle single page result', () => {
      const data = [{ id: '1' }];
      const dto: PaginationQueryDto = { page: 1, limit: 10 };
      const result = buildPaginatedResponse(data, 1, dto);

      expect(result.meta.totalPages).toBe(1);
      expect(result.meta.hasNextPage).toBe(false);
      expect(result.meta.hasPreviousPage).toBe(false);
    });
  });
});
