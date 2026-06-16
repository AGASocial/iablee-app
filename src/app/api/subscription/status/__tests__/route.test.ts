/**
 * @jest-environment node
 */
import { GET } from '../route';
import { getSubscriptionStatus } from '@/lib/subscription/limits';

jest.mock('@/lib/supabase-server', () => ({
  createAuthenticatedRouteClient: jest.fn(),
}));

jest.mock('@/lib/subscription/limits', () => ({
  getSubscriptionStatus: jest.fn(),
}));

describe('GET /api/subscription/status', () => {
  const mockGetSubscriptionStatus = getSubscriptionStatus as jest.Mock;
  const { createAuthenticatedRouteClient } = jest.requireMock('@/lib/supabase-server') as {
    createAuthenticatedRouteClient: jest.Mock;
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    createAuthenticatedRouteClient.mockResolvedValue({ supabase: {}, user: null });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
  });

  it('delegates to getSubscriptionStatus (single query group via limits.ts)', async () => {
    const status = {
      hasSubscription: true,
      planName: 'Pro',
      limits: { maxAssets: 50, maxBeneficiaries: 10, maxStorageMb: 1000, maxFileSizeMb: 25 },
      usage: { assetsCount: 3, beneficiariesCount: 2, storageUsedMb: 12 },
    };

    createAuthenticatedRouteClient.mockResolvedValue({
      supabase: {},
      user: { id: 'user-1' },
    });
    mockGetSubscriptionStatus.mockResolvedValue(status);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(status);
    expect(mockGetSubscriptionStatus).toHaveBeenCalledTimes(1);
    expect(mockGetSubscriptionStatus).toHaveBeenCalledWith({}, 'user-1');
  });
});
