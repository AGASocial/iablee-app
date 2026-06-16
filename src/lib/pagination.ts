/**
 * Shared cursor pagination utilities for list endpoints.
 *
 * Frontend integration contract:
 * - Request: ?limit=20&cursor=<base64-encoded-cursor>
 * - Response: { data: T[], pagination: { limit, hasMore, nextCursor } }
 * - Default limit: 20, max limit: 100
 */

export interface PaginationMeta {
  limit: number;
  hasMore: boolean;
  nextCursor: string | null;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: PaginationMeta;
}

export interface CursorPayload {
  id: string;
  sortValue: string;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export function parsePaginationParams(searchParams: URLSearchParams): {
  limit: number;
  cursor: CursorPayload | null;
} {
  const rawLimit = parseInt(searchParams.get('limit') || String(DEFAULT_LIMIT), 10);
  const limit = Math.min(Math.max(1, isNaN(rawLimit) ? DEFAULT_LIMIT : rawLimit), MAX_LIMIT);

  const cursorParam = searchParams.get('cursor');
  if (!cursorParam) {
    return { limit, cursor: null };
  }

  try {
    const decoded = JSON.parse(Buffer.from(cursorParam, 'base64url').toString('utf-8')) as CursorPayload;
    if (decoded.id && decoded.sortValue !== undefined) {
      return { limit, cursor: decoded };
    }
  } catch {
    // Invalid cursor — start from beginning
  }

  return { limit, cursor: null };
}

export function encodeCursor(id: string, sortValue: string): string {
  return Buffer.from(JSON.stringify({ id, sortValue })).toString('base64url');
}

export function buildPaginatedResponse<T>(
  rows: T[],
  limit: number,
  getCursorFields: (row: T) => { id: string; sortValue: string }
): PaginatedResponse<T> {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const lastItem = data[data.length - 1];

  return {
    data,
    pagination: {
      limit,
      hasMore,
      nextCursor: hasMore && lastItem
        ? encodeCursor(getCursorFields(lastItem).id, getCursorFields(lastItem).sortValue)
        : null,
    },
  };
}
