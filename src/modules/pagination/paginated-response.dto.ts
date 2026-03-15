export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  nextCursor?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: PaginationMeta;
}
