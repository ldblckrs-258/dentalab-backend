import { BadRequestException } from '@nestjs/common';
import type { PaginationQueryDto } from './pagination-query.dto';
import type {
  PaginatedResponse,
  PaginationMeta,
} from './paginated-response.dto';

export interface PrismaQueryArgs {
  skip?: number;
  take: number;
  cursor?: { id: string };
  orderBy?: Record<string, 'asc' | 'desc'>;
}

export function buildPrismaQuery(
  dto: PaginationQueryDto,
  allowedSortFields: string[],
): PrismaQueryArgs {
  const limit = dto.limit ?? 20;
  const args: PrismaQueryArgs = { take: limit };

  if (dto.cursor) {
    args.cursor = { id: dto.cursor };
    args.skip = 1; // Skip the cursor itself
  } else {
    const page = dto.page ?? 1;
    args.skip = (page - 1) * limit;
  }

  if (dto.sortBy) {
    if (!allowedSortFields.includes(dto.sortBy)) {
      throw new BadRequestException(
        `Invalid sort field '${dto.sortBy}'. Allowed: ${allowedSortFields.join(', ')}`,
      );
    }
    args.orderBy = { [dto.sortBy]: dto.sortOrder ?? 'desc' };
  } else {
    args.orderBy = { created_at: 'desc' };
  }

  return args;
}

export function buildPaginatedResponse<T>(
  data: T[],
  total: number,
  dto: PaginationQueryDto,
): PaginatedResponse<T> {
  const limit = dto.limit ?? 20;
  const page = dto.page ?? 1;
  const totalPages = Math.ceil(total / limit);

  const meta: PaginationMeta = {
    total,
    page,
    limit,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
  };

  // Add cursor for cursor-based pagination
  if (dto.cursor && data.length > 0) {
    const lastItem = data[data.length - 1] as Record<string, unknown>;
    if (lastItem && 'id' in lastItem) {
      meta.nextCursor = lastItem.id as string;
    }
  }

  return { data, meta };
}
