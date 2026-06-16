import {
  parsePaginationParams,
  buildPaginatedResponse,
  encodeCursor,
} from '../pagination';

describe('pagination utilities', () => {
  it('parses default limit when no params provided', () => {
    const params = parsePaginationParams(new URLSearchParams());
    expect(params.limit).toBe(20);
    expect(params.cursor).toBeNull();
  });

  it('caps limit at max 100', () => {
    const params = parsePaginationParams(new URLSearchParams({ limit: '500' }));
    expect(params.limit).toBe(100);
  });

  it('decodes valid cursor', () => {
    const cursor = encodeCursor('asset-1', 'Alpha');
    const params = parsePaginationParams(new URLSearchParams({ cursor }));
    expect(params.cursor).toEqual({ id: 'asset-1', sortValue: 'Alpha' });
  });

  it('builds paginated response with nextCursor when hasMore', () => {
    const rows = Array.from({ length: 21 }, (_, i) => ({
      id: `id-${i}`,
      name: `Item ${i}`,
    }));

    const result = buildPaginatedResponse(rows, 20, (row) => ({
      id: row.id,
      sortValue: row.name,
    }));

    expect(result.data).toHaveLength(20);
    expect(result.pagination.hasMore).toBe(true);
    expect(result.pagination.nextCursor).toBeTruthy();
    expect(result.pagination.limit).toBe(20);
  });

  it('returns null nextCursor when no more pages', () => {
    const rows = [{ id: 'only', name: 'One' }];
    const result = buildPaginatedResponse(rows, 20, (row) => ({
      id: row.id,
      sortValue: row.name,
    }));

    expect(result.pagination.hasMore).toBe(false);
    expect(result.pagination.nextCursor).toBeNull();
  });
});
