/**
 * @jest-environment node
 */
import { GET } from '../route';
import { createAuthenticatedRouteClient } from '@/lib/supabase-server';

jest.mock('@/lib/supabase-server', () => ({
  createAuthenticatedRouteClient: jest.fn(),
}));

function makeBuilder(resolved: unknown, withLimit = true) {
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    then: (
      onFulfilled: (v: unknown) => unknown,
      onRejected?: (e: unknown) => unknown
    ) => Promise.resolve(resolved).then(onFulfilled, onRejected),
  };
  if (withLimit) {
    builder.limit = () => Promise.resolve(resolved);
  }
  return builder;
}

describe('GET /api/dashboard', () => {
  const mockCreateAuth = createAuthenticatedRouteClient as jest.Mock;
  const request = new Request('http://localhost/api/dashboard');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    mockCreateAuth.mockResolvedValue({ supabase: {}, user: null });
    const response = await GET(request);
    expect(response.status).toBe(401);
  });

  it('returns correct totals when user has more than 5 records', async () => {
    const assetsList = Array.from({ length: 5 }, (_, i) => ({ id: `a${i}`, asset_name: `Asset ${i}` }));
    const beneficiariesList = Array.from({ length: 5 }, (_, i) => ({ id: `b${i}`, full_name: `Ben ${i}` }));

    const builders = [
      makeBuilder({ data: assetsList, error: null }),
      makeBuilder({ data: beneficiariesList, error: null }),
      makeBuilder({ count: 12, error: null }, false),
      makeBuilder({ count: 8, error: null }, false),
      makeBuilder({ count: 3, error: null }, false),
    ];

    let callIndex = 0;
    const supabase = {
      from: jest.fn(() => builders[callIndex++]),
    };

    mockCreateAuth.mockResolvedValue({ supabase, user: { id: 'user-1' } });

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.assets).toHaveLength(5);
    expect(body.beneficiaries).toHaveLength(5);
    expect(body.stats).toEqual({
      totalAssets: 12,
      totalBeneficiaries: 8,
      protectedAssets: 3,
      recentActivity: 0,
    });
  });
});
