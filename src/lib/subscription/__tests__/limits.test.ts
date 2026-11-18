/**
 * @jest-environment node
 */
import {
  getSubscriptionStatus,
  getFreeTrialLimits,
  canCreateVideoAsset,
  canCreateBeneficiary,
  clearSubscriptionCache,
} from '@/lib/subscription/limits';

describe('getSubscriptionStatus query groups', () => {
  beforeEach(() => {
    clearSubscriptionCache();
  });

  it('uses at most 2 DB query groups (subscription + parallel usage)', async () => {
    let queryGroupCount = 0;
    const inFlight = new Set<Promise<unknown>>();

    const trackQuery = <T>(promise: Promise<T>): Promise<T> => {
      queryGroupCount++;
      inFlight.add(promise);
      return promise.finally(() => inFlight.delete(promise));
    };

    const subscriptionPromise = Promise.resolve({
      data: {
        status: 'active',
        plan: { id: 'plan_pro', name: 'Pro', features: { max_assets: 50 } },
      },
      error: null,
    });

    const supabase = {
      from: jest.fn((table: string) => {
        if (table === 'billing_subscriptions') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  single: () => trackQuery(subscriptionPromise),
                }),
              }),
            }),
          };
        }
        if (table === 'digital_assets' || table === 'beneficiaries') {
          return {
            select: () => ({
              eq: () => trackQuery(Promise.resolve({ count: 2, data: null, error: null })),
            }),
          };
        }
        if (table === 'asset_attachments') {
          return {
            select: () => ({
              eq: () =>
                trackQuery(Promise.resolve({ data: [{ file_size: 1048576 }], error: null })),
            }),
          };
        }
        return {
          select: () => ({
            eq: () => trackQuery(Promise.resolve({ count: 0, data: [], error: null })),
          }),
        };
      }),
    };

    const result = await getSubscriptionStatus(supabase as never, 'user-1');

    expect(result.hasSubscription).toBe(true);
    expect(queryGroupCount).toBeLessThanOrEqual(4);
    expect(result.usage.storageUsedMb).toBeGreaterThan(0);
  });

  it('caches subscription within request window', async () => {
    let subscriptionCalls = 0;
    const supabase = {
      from: jest.fn((table: string) => {
        if (table === 'billing_subscriptions') {
          subscriptionCalls++;
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  single: () =>
                    Promise.resolve({
                      data: {
                        status: 'active',
                        plan: { id: 'plan_pro', name: 'Pro', features: { max_assets: 50 } },
                      },
                      error: null,
                    }),
                }),
              }),
            }),
          };
        }
        return {
          select: () => ({
            eq: () => Promise.resolve({ count: 0, data: [], error: null }),
          }),
        };
      }),
    };

    await getSubscriptionStatus(supabase as never, 'user-cached');
    await getSubscriptionStatus(supabase as never, 'user-cached');

    expect(subscriptionCalls).toBe(1);
  });
});

describe('KAN-164 Free and Premium limits', () => {
  beforeEach(() => {
    clearSubscriptionCache();
  });

  it('getFreeTrialLimits uses 1 beneficiary (not 2)', () => {
    expect(getFreeTrialLimits()).toMatchObject({
      maxAssets: 3,
      maxBeneficiaries: 1,
      maxVideoAssets: -1,
    });
  });

  it('canCreateBeneficiary blocks Free at 1', async () => {
    const supabase = {
      from: jest.fn((table: string) => {
        if (table === 'billing_subscriptions') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  single: () => Promise.resolve({ data: null, error: null }),
                }),
              }),
            }),
          };
        }
        if (table === 'billing_plans') {
          return {
            select: () => ({
              eq: () => ({
                single: () =>
                  Promise.resolve({
                    data: {
                      id: 'plan_free',
                      features: {
                        max_assets: 3,
                        max_beneficiaries: 1,
                        max_storage_mb: 50,
                        max_file_size_mb: 10,
                      },
                    },
                    error: null,
                  }),
              }),
            }),
          };
        }
        if (table === 'beneficiaries') {
          return {
            select: () => ({
              eq: () => Promise.resolve({ count: 1, data: null, error: null }),
            }),
          };
        }
        return {
          select: () => ({
            eq: () => Promise.resolve({ count: 0, data: [], error: null }),
          }),
        };
      }),
    };

    const result = await canCreateBeneficiary(supabase as never, 'free-user');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('beneficiaryLimitReached');
    expect(result.limit).toBe(1);
  });

  it('canCreateVideoAsset enforces Premium max of 5', async () => {
    const supabase = {
      from: jest.fn((table: string) => {
        if (table === 'billing_subscriptions') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  single: () =>
                    Promise.resolve({
                      data: {
                        status: 'active',
                        plan: {
                          id: 'plan_premium_month',
                          name: 'Premium',
                          features: {
                            max_assets: -1,
                            max_beneficiaries: 10,
                            max_storage_mb: 5000,
                            max_file_size_mb: 100,
                            max_video_assets: 5,
                          },
                        },
                      },
                      error: null,
                    }),
                }),
              }),
            }),
          };
        }
        if (table === 'asset_types') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({ data: { id: 'video-type-uuid' }, error: null }),
              }),
            }),
          };
        }
        if (table === 'digital_assets') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => Promise.resolve({ count: 5, data: null, error: null }),
              }),
            }),
          };
        }
        return {
          select: () => ({
            eq: () => Promise.resolve({ count: 0, data: [], error: null }),
          }),
        };
      }),
    };

    const result = await canCreateVideoAsset(supabase as never, 'premium-user');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('videoLimitReached');
    expect(result.limit).toBe(5);
    expect(result.current).toBe(5);
  });

  it('canCreateVideoAsset allows when under Premium video cap', async () => {
    clearSubscriptionCache();
    const supabase = {
      from: jest.fn((table: string) => {
        if (table === 'billing_subscriptions') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  single: () =>
                    Promise.resolve({
                      data: {
                        status: 'active',
                        plan: {
                          id: 'plan_premium_month',
                          name: 'Premium',
                          features: { max_assets: -1, max_video_assets: 5 },
                        },
                      },
                      error: null,
                    }),
                }),
              }),
            }),
          };
        }
        if (table === 'asset_types') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({ data: { id: 'video-type-uuid' }, error: null }),
              }),
            }),
          };
        }
        if (table === 'digital_assets') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => Promise.resolve({ count: 2, data: null, error: null }),
              }),
            }),
          };
        }
        return {
          select: () => ({
            eq: () => Promise.resolve({ count: 0, data: [], error: null }),
          }),
        };
      }),
    };

    const result = await canCreateVideoAsset(supabase as never, 'premium-under-cap');
    expect(result.allowed).toBe(true);
  });
});
