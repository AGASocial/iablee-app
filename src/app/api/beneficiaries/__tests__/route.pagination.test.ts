/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';
import { GET } from '../route';
import { getAuthenticatedContext } from '@/lib/auth-context';

jest.mock('@/lib/auth-context', () => ({
  getAuthenticatedContext: jest.fn(),
}));
jest.mock('@/lib/observability', () => ({
  withTiming: (_name: string, handler: (...args: unknown[]) => unknown) => handler,
}));

describe('GET /api/beneficiaries pagination contract', () => {
  const mockGetAuthenticatedContext = getAuthenticatedContext as jest.Mock;

  const mockRows = Array.from({ length: 21 }, (_, i) => ({
    id: `ben-${i}`,
    full_name: `Person ${String(i).padStart(2, '0')}`,
    email: `person${i}@example.com`,
  }));

  function createSupabaseMock(rows: typeof mockRows) {
    const query = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue({ data: rows, error: null }),
      or: jest.fn().mockResolvedValue({ data: rows, error: null }),
    };
    return { from: jest.fn(() => query), query };
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns paginated response shape', async () => {
    const supabase = createSupabaseMock(mockRows);
    mockGetAuthenticatedContext.mockResolvedValue({
      ok: true,
      ctx: {
        user: { id: 'user-1' },
        supabase,
        hasSecuritySession: true,
        hasPin: false,
        pinRequired: false,
      },
    });

    const request = new NextRequest('http://localhost/api/beneficiaries?limit=20');
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toHaveLength(20);
    expect(body.pagination).toEqual({
      limit: 20,
      hasMore: true,
      nextCursor: expect.any(String),
    });
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetAuthenticatedContext.mockResolvedValue({
      ok: false,
      status: 401,
      error: 'Unauthorized',
    });

    const request = new NextRequest('http://localhost/api/beneficiaries');
    const response = await GET(request);

    expect(response.status).toBe(401);
  });
});
