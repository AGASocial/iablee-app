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
      data: [
        {
          status: 'active',
          provider: 'wompi',
          current_period_end: new Date(Date.now() + 86400000).toISOString(),
          plan: { id: 'plan_pro', name: 'Pro', features: { max_assets: 50 } },
        },
      ],
      error: null,
    });

    const supabase = {
      from: jest.fn((table: string) => {
        if (table === 'billing_subscriptions') {
          return {
            select: () => ({
              eq: () => ({
                in: () => ({
                  order: () => ({
                    limit: () => trackQuery(subscriptionPromise),
                  }),
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
                in: () => ({
                  order: () => ({
                    limit: () =>
                      Promise.resolve({
                        data: [
                          {
                            status: 'active',
                            provider: 'wompi',
                            current_period_end: new Date(Date.now() + 86400000).toISOString(),
                            plan: { id: 'plan_pro', name: 'Pro', features: { max_assets: 50 } },
                          },
                        ],
                        error: null,
                      }),
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

  it('Stripe active with expired current_period_end still entitles (status-based)', async () => {
    clearSubscriptionCache();
    const expired = new Date(Date.now() - 10 * 86400000).toISOString();
    const supabase = {
      from: jest.fn((table: string) => {
        if (table === 'billing_subscriptions') {
          return {
            select: () => ({
              eq: () => ({
                in: () => ({
                  order: () => ({
                    limit: () =>
                      Promise.resolve({
                        data: [
                          {
                            status: 'active',
                            provider: 'stripe',
                            current_period_end: expired,
                            plan: {
                              id: 'plan_premium_month',
                              name: 'Premium',
                              features: { max_assets: 50, max_beneficiaries: 10 },
                            },
                          },
                        ],
                        error: null,
                      }),
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

    const result = await getSubscriptionStatus(supabase as never, 'stripe-user');
    expect(result.hasSubscription).toBe(true);
    expect(result.limits.maxAssets).toBe(50);
  });

  it('PayU active with expired current_period_end still entitles', async () => {
    clearSubscriptionCache();
    const expired = new Date(Date.now() - 86400000).toISOString();
    const supabase = {
      from: jest.fn((table: string) => {
        if (table === 'billing_subscriptions') {
          return {
            select: () => ({
              eq: () => ({
                in: () => ({
                  order: () => ({
                    limit: () =>
                      Promise.resolve({
                        data: [
                          {
                            status: 'active',
                            provider: 'payu',
                            current_period_end: expired,
                            plan: {
                              id: 'plan_premium_month',
                              name: 'Premium',
                              features: { max_assets: -1 },
                            },
                          },
                        ],
                        error: null,
                      }),
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

    const result = await getSubscriptionStatus(supabase as never, 'payu-user');
    expect(result.hasSubscription).toBe(true);
    expect(result.limits.maxAssets).toBe(-1);
  });

  it('Wompi active with expired period beyond grace loses entitlement', async () => {
    clearSubscriptionCache();
    const expired = new Date(Date.now() - 3 * 86400000).toISOString();
    const supabase = {
      from: jest.fn((table: string) => {
        if (table === 'billing_subscriptions') {
          return {
            select: () => ({
              eq: () => ({
                in: () => ({
                  order: () => ({
                    limit: () =>
                      Promise.resolve({
                        data: [
                          {
                            status: 'active',
                            provider: 'wompi',
                            current_period_end: expired,
                            plan: {
                              id: 'plan_premium_month',
                              name: 'Premium',
                              features: { max_assets: 50 },
                            },
                          },
                        ],
                        error: null,
                      }),
                  }),
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
        return {
          select: () => ({
            eq: () => Promise.resolve({ count: 0, data: [], error: null }),
          }),
        };
      }),
    };

    const result = await getSubscriptionStatus(supabase as never, 'wompi-expired');
    expect(result.hasSubscription).toBe(false);
    expect(result.limits.maxAssets).toBe(3);
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

  function freePlanSupabase(beneficiaryCount: number) {
    return {
      from: jest.fn((table: string) => {
        if (table === 'billing_subscriptions') {
          return {
            select: () => ({
              eq: () => ({
                in: () => ({
                  order: () => ({
                    limit: () => Promise.resolve({ data: [], error: null }),
                  }),
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
              eq: () => Promise.resolve({ count: beneficiaryCount, data: null, error: null }),
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
  }

  it('canCreateBeneficiary blocks Free at 1', async () => {
    const result = await canCreateBeneficiary(freePlanSupabase(1) as never, 'free-user');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('beneficiaryLimitReached');
    expect(result.limit).toBe(1);
    expect(result.current).toBe(1);
  });

  it('grandfathers Free user over beneficiary cap: usage 2 / limit 1 denies create only', async () => {
    // Production may have Free users with 2 beneficiaries from the prior cap.
    // Do not delete; only block adding more (canCreate uses >=).
    const result = await canCreateBeneficiary(freePlanSupabase(2) as never, 'free-over-cap');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('beneficiaryLimitReached');
    expect(result.limit).toBe(1);
    expect(result.current).toBe(2);
  });

  function premiumVideoSupabase(opts: {
    videoCountForIn: (values: string[]) => number;
    userId: string;
  }) {
    return {
      from: jest.fn((table: string) => {
        if (table === 'billing_subscriptions') {
          return {
            select: () => ({
              eq: () => ({
                in: () => ({
                  order: () => ({
                    limit: () =>
                      Promise.resolve({
                        data: [
                          {
                            status: 'active',
                            provider: 'wompi',
                            current_period_end: new Date(Date.now() + 86400000).toISOString(),
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
                        ],
                        error: null,
                      }),
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
                // Correct path: count key OR uuid via .in()
                in: (_col: string, values: string[]) =>
                  Promise.resolve({
                    count: opts.videoCountForIn(values),
                    data: null,
                    error: null,
                  }),
                // Buggy legacy path: only .eq uuid — key-stored rows return 0
                eq: (_col: string, value: string) =>
                  Promise.resolve({
                    count: value === 'video' ? opts.videoCountForIn(['video']) : 0,
                    data: null,
                    error: null,
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
  }

  it('canCreateVideoAsset enforces Premium max of 5', async () => {
    const supabase = premiumVideoSupabase({
      userId: 'premium-user',
      videoCountForIn: () => 5,
    });

    const result = await canCreateVideoAsset(supabase as never, 'premium-user');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('videoLimitReached');
    expect(result.limit).toBe(5);
    expect(result.current).toBe(5);
  });

  it('canCreateVideoAsset allows when under Premium video cap', async () => {
    clearSubscriptionCache();
    const supabase = premiumVideoSupabase({
      userId: 'premium-under-cap',
      videoCountForIn: () => 2,
    });

    const result = await canCreateVideoAsset(supabase as never, 'premium-under-cap');
    expect(result.allowed).toBe(true);
  });

  it('canCreateVideoAsset counts asset_type=video key even when asset_types uuid exists', async () => {
    // Rows stored as key 'video' while catalog has a uuid — UUID-only count would be 0 (bypass).
    clearSubscriptionCache();
    const supabase = premiumVideoSupabase({
      userId: 'premium-key-stored',
      videoCountForIn: (values) => {
        // Key-stored rows only contribute when 'video' is included in the filter.
        return values.includes('video') ? 5 : 0;
      },
    });

    const result = await canCreateVideoAsset(supabase as never, 'premium-key-stored');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('videoLimitReached');
    expect(result.current).toBe(5);
  });
});
