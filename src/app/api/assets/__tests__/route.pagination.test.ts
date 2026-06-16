/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';
import { GET } from '../route';
import { getAuthenticatedContext } from '@/lib/auth-context';
import { supabaseAdmin } from '@/lib/supabase-admin';

jest.mock('@/lib/auth-context', () => ({
  getAuthenticatedContext: jest.fn(),
}));
jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { from: jest.fn() },
}));
jest.mock('@/lib/observability', () => ({
  withTiming: (_name: string, handler: (...args: unknown[]) => unknown) => handler,
}));

describe('GET /api/assets pagination contract', () => {
  const mockGetAuthenticatedContext = getAuthenticatedContext as jest.Mock;
  const mockFrom = supabaseAdmin.from as jest.Mock;

  const mockRows = Array.from({ length: 21 }, (_, i) => ({
    id: `asset-${i}`,
    asset_name: `Asset ${String(i).padStart(2, '0')}`,
    asset_type: 'email',
    status: 'active',
  }));

  beforeEach(() => {
    jest.clearAllMocks();

    const query = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue({ data: mockRows, error: null }),
      or: jest.fn().mockResolvedValue({ data: mockRows, error: null }),
    };
    mockFrom.mockReturnValue(query);
  });

  it('returns paginated response shape', async () => {
    mockGetAuthenticatedContext.mockResolvedValue({
      ok: true,
      ctx: {
        user: { id: 'user-1' },
        hasSecuritySession: true,
        hasPin: false,
        pinRequired: false,
      },
    });

    const request = new NextRequest('http://localhost/api/assets?limit=20');
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

  it('list response excludes decrypted credential fields', async () => {
    mockGetAuthenticatedContext.mockResolvedValue({
      ok: true,
      ctx: {
        user: { id: 'user-1' },
        hasSecuritySession: true,
        hasPin: false,
        pinRequired: false,
      },
    });

    const request = new NextRequest('http://localhost/api/assets?limit=20');
    const response = await GET(request);
    const body = await response.json();

    for (const item of body.data) {
      expect(item).not.toHaveProperty('decrypted_password');
      expect(item).not.toHaveProperty('decrypted_custom_fields');
      expect(item).not.toHaveProperty('password');
    }

    const selectCall = mockFrom.mock.results[0].value.select;
    expect(selectCall).toHaveBeenCalledWith(
      expect.not.stringContaining('decrypted_password')
    );
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetAuthenticatedContext.mockResolvedValue({
      ok: false,
      status: 401,
      error: 'Unauthorized',
    });

    const request = new NextRequest('http://localhost/api/assets');
    const response = await GET(request);

    expect(response.status).toBe(401);
  });
});
