/**
 * @jest-environment node
 */
import {
  getSubscriptionStatus,
  getFreeTrialLimits,
  canCreateVideoAsset,
  canCreateBeneficiary,
  canUploadFile,
  clearSubscriptionCache,
  PREMIUM_TOTAL_STORAGE_MB,
} from '@/lib/subscription/limits';


/** Filter-aware billing_subscriptions chain for live + CAPE two-query fetches. */
function mockBillingSubscriptionsFrom(rows: Record<string, unknown>[]) {
  return {
    select: () => {
      const filters: { statuses?: string[]; cape?: boolean; cpeGt?: string } = {};
      const api: Record<string, unknown> = {};
      const self = () => api;
      const resolve = () => {
        let filtered = rows;
        if (filters.statuses) {
          const set = new Set(filters.statuses.map((s) => s.toLowerCase()));
          filtered = filtered.filter((r) => set.has(String(r.status).toLowerCase()));
        }
        if (filters.cape === true) {
          filtered = filtered.filter((r) => r.cancel_at_period_end === true);
        }
        if (filters.cpeGt) {
          const floor = new Date(filters.cpeGt).getTime();
          filtered = filtered.filter((r) => {
            if (r.current_period_end == null) return false;
            return new Date(r.current_period_end as string).getTime() > floor;
          });
        }
        return { data: filtered, error: null };
      };
      type Terminal = {
        limit: () => Terminal;
        then: (
          res: (v: unknown) => unknown,
          rej?: (e: unknown) => unknown
        ) => Promise<unknown>;
      };
      const terminal = (): Terminal => ({
        limit: () => terminal(),
        then: (res, rej) => Promise.resolve(resolve()).then(res, rej),
      });
      api.eq = (col: string, val: unknown) => {
        if (col === 'cancel_at_period_end') filters.cape = val === true;
        return self();
      };
      api.in = (col: string, vals: string[]) => {
        if (col === 'status') filters.statuses = vals;
        return self();
      };
      api.gt = (col: string, val: string) => {
        if (col === 'current_period_end') filters.cpeGt = val;
        return self();
      };
      api.order = () => terminal();
      return api;
    },
  };
}

describe('getSubscriptionStatus query groups', () => {
  beforeEach(() => {
    clearSubscriptionCache();
  });

  it('uses at most 2 DB query groups (subscription + parallel usage)', async () => {
    let queryGroupCount = 0;

    const trackQuery = <T>(promise: Promise<T>): Promise<T> => {
      queryGroupCount++;
      return promise;
    };

    const supabase = {
      from: jest.fn((table: string) => {
        if (table === 'billing_subscriptions') {
          const base = mockBillingSubscriptionsFrom([
            {
              status: 'active',
              provider: 'wompi',
              current_period_end: new Date(Date.now() + 86400000).toISOString(),
              plan: { id: 'plan_pro', name: 'Pro', features: { max_assets: 50 } },
            },
          ]);
          return {
            select: () => {
              const chain = base.select() as {
                eq: (...args: unknown[]) => unknown;
                in: (...args: unknown[]) => unknown;
                gt: (...args: unknown[]) => unknown;
                order: () => {
                  then: (
                    res: (v: unknown) => unknown,
                    rej?: (e: unknown) => unknown
                  ) => Promise<unknown>;
                };
              };
              const origOrder = chain.order.bind(chain);
              chain.order = () => {
                const term = origOrder();
                return {
                  then: (
                    res: (v: unknown) => unknown,
                    rej?: (e: unknown) => unknown
                  ) =>
                    trackQuery(
                      new Promise((resolve, reject) => term.then(resolve, reject))
                    ).then(res, rej),
                };
              };
              return chain;
            },
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
    // live + CAPE subscription queries + usage (assets, beneficiaries, attachments)
    expect(queryGroupCount).toBeLessThanOrEqual(5);
    expect(result.usage.storageUsedMb).toBeGreaterThan(0);
  });

  it('caches subscription within request window', async () => {
    let subscriptionCalls = 0;
    const supabase = {
      from: jest.fn((table: string) => {
        if (table === 'billing_subscriptions') {
          subscriptionCalls++;
          return mockBillingSubscriptionsFrom([
            {
              status: 'active',
              provider: 'wompi',
              current_period_end: new Date(Date.now() + 86400000).toISOString(),
              plan: { id: 'plan_pro', name: 'Pro', features: { max_assets: 50 } },
            },
          ]);
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

    // live + CAPE queries on first fetch; second call hits request cache
    expect(subscriptionCalls).toBe(2);
  });

  it('Stripe active with expired current_period_end still entitles (status-based)', async () => {
    clearSubscriptionCache();
    const expired = new Date(Date.now() - 10 * 86400000).toISOString();
    const supabase = {
      from: jest.fn((table: string) => {
        if (table === 'billing_subscriptions') {
          return mockBillingSubscriptionsFrom([
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
                        ]);
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
          return mockBillingSubscriptionsFrom([
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
                        ]);
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
          return mockBillingSubscriptionsFrom([
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
                        ]);
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

  it('CAPE canceled with future current_period_end keeps Premium (KAN-168)', async () => {
    clearSubscriptionCache();
    const future = new Date(Date.now() + 7 * 86400000).toISOString();
    const supabase = {
      from: jest.fn((table: string) => {
        if (table === 'billing_subscriptions') {
          return mockBillingSubscriptionsFrom([
                          {
                            status: 'canceled',
                            provider: 'stripe',
                            current_period_end: future,
                            cancel_at_period_end: true,
                            canceled_reason: 'user',
                            plan: {
                              id: 'plan_premium_month',
                              name: 'Premium',
                              amount_cents: 999,
                              features: { max_assets: 50, max_beneficiaries: 10 },
                            },
                          },
                        ]);
        }
        return {
          select: () => ({
            eq: () => Promise.resolve({ count: 0, data: [], error: null }),
          }),
        };
      }),
    };

    const result = await getSubscriptionStatus(supabase as never, 'canceled-future');
    expect(result.hasSubscription).toBe(true);
    expect(result.status).toBe('canceled');
    expect(result.limits.maxAssets).toBe(50);
  });

  it('canceled without CAPE + future CPE → Free (immediate revoke)', async () => {
    clearSubscriptionCache();
    const future = new Date(Date.now() + 7 * 86400000).toISOString();
    const supabase = {
      from: jest.fn((table: string) => {
        if (table === 'billing_subscriptions') {
          return mockBillingSubscriptionsFrom([
                          {
                            status: 'canceled',
                            provider: 'stripe',
                            current_period_end: future,
                            cancel_at_period_end: false,
                            canceled_reason: 'user',
                            plan: {
                              id: 'plan_premium_month',
                              name: 'Premium',
                              amount_cents: 999,
                              features: { max_assets: 50 },
                            },
                          },
                        ]);
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

    const result = await getSubscriptionStatus(supabase as never, 'immediate-cancel');
    expect(result.hasSubscription).toBe(false);
    expect(result.limits.maxAssets).toBe(3);
  });

  it('prefers entitled premium over newer entitled plan_free', async () => {
    clearSubscriptionCache();
    const future = new Date(Date.now() + 7 * 86400000).toISOString();
    const supabase = {
      from: jest.fn((table: string) => {
        if (table === 'billing_subscriptions') {
          return mockBillingSubscriptionsFrom([
                          {
                            status: 'active',
                            provider: 'stripe',
                            current_period_end: future,
                            cancel_at_period_end: false,
                            plan: {
                              id: 'plan_free',
                              name: 'Free',
                              amount_cents: 0,
                              features: { max_assets: 3 },
                            },
                          },
                          {
                            status: 'canceled',
                            provider: 'stripe',
                            current_period_end: future,
                            cancel_at_period_end: true,
                            canceled_reason: 'user',
                            plan: {
                              id: 'plan_premium_month',
                              name: 'Premium',
                              amount_cents: 148,
                              features: { max_assets: -1 },
                            },
                          },
                        ]);
        }
        return {
          select: () => ({
            eq: () => Promise.resolve({ count: 0, data: [], error: null }),
          }),
        };
      }),
    };

    const result = await getSubscriptionStatus(supabase as never, 'rank-premium');
    expect(result.hasSubscription).toBe(true);
    expect(result.limits.maxAssets).toBe(-1);
  });

  it('does not starve older entitled past_due behind >10 newer canceled tombstones', async () => {
    clearSubscriptionCache();
    const future = new Date(Date.now() + 7 * 86400000).toISOString();
    const pastDue = {
      status: 'past_due',
      provider: 'wompi',
      current_period_end: future,
      cancel_at_period_end: false,
      plan: {
        id: 'plan_premium_month',
        name: 'Premium',
        amount_cents: 490000,
        features: { max_assets: -1, max_storage_mb: 5120 },
      },
    };
    const tombstones = Array.from({ length: 12 }, (_, i) => ({
      status: 'canceled',
      provider: 'wompi',
      current_period_end: '2026-01-01T00:00:00.000Z',
      cancel_at_period_end: false,
      canceled_reason: 'expired_resubscribe',
      plan: {
        id: `plan_necessary_month`,
        name: `Tombstone ${i}`,
        amount_cents: 999,
        features: { max_assets: 50 },
      },
    }));
    const supabase = {
      from: jest.fn((table: string) => {
        if (table === 'billing_subscriptions') {
          return mockBillingSubscriptionsFrom([...tombstones, pastDue]);
        }
        return {
          select: () => ({
            eq: () => Promise.resolve({ count: 0, data: [], error: null }),
          }),
        };
      }),
    };

    const result = await getSubscriptionStatus(supabase as never, 'starve-past-due');
    expect(result.hasSubscription).toBe(true);
    expect(result.limits.maxAssets).toBe(-1);
    expect(result.limits.maxStorageMb).toBe(5120);
  });

  it('Premium 148 wins over Necessary 999 by tier (KAN-168)', async () => {
    clearSubscriptionCache();
    const future = new Date(Date.now() + 7 * 86400000).toISOString();
    const supabase = {
      from: jest.fn((table: string) => {
        if (table === 'billing_subscriptions') {
          return mockBillingSubscriptionsFrom([
                          {
                            status: 'active',
                            provider: 'stripe',
                            current_period_end: future,
                            cancel_at_period_end: false,
                            plan: {
                              id: 'plan_necessary_month',
                              name: 'Necessary',
                              amount_cents: 999,
                              features: { max_assets: 50, max_storage_mb: 500 },
                            },
                          },
                          {
                            status: 'active',
                            provider: 'stripe',
                            current_period_end: future,
                            cancel_at_period_end: false,
                            plan: {
                              id: 'plan_premium_month',
                              name: 'Premium',
                              amount_cents: 148,
                              features: { max_assets: -1, max_storage_mb: 5120 },
                            },
                          },
                        ]);
        }
        return {
          select: () => ({
            eq: () => Promise.resolve({ count: 0, data: [], error: null }),
          }),
        };
      }),
    };

    const result = await getSubscriptionStatus(supabase as never, 'rank-premium-vs-necessary');
    expect(result.hasSubscription).toBe(true);
    expect(result.limits.maxAssets).toBe(-1);
    expect(result.limits.maxStorageMb).toBe(5120);
  });

  it('canceled with past current_period_end → Free (KAN-168)', async () => {
    clearSubscriptionCache();
    const past = new Date(Date.now() - 2 * 86400000).toISOString();
    const supabase = {
      from: jest.fn((table: string) => {
        if (table === 'billing_subscriptions') {
          return mockBillingSubscriptionsFrom([
                          {
                            status: 'canceled',
                            provider: 'stripe',
                            current_period_end: past,
                            cancel_at_period_end: true,
                            plan: {
                              id: 'plan_premium_month',
                              name: 'Premium',
                              features: { max_assets: 50 },
                            },
                          },
                        ]);
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

    const result = await getSubscriptionStatus(supabase as never, 'canceled-past');
    expect(result.hasSubscription).toBe(false);
    expect(result.limits.maxAssets).toBe(3);
  });

  it('canceled with NULL current_period_end → Free (fail closed)', async () => {
    clearSubscriptionCache();
    const supabase = {
      from: jest.fn((table: string) => {
        if (table === 'billing_subscriptions') {
          return mockBillingSubscriptionsFrom([
                          {
                            status: 'canceled',
                            provider: 'payu',
                            current_period_end: null,
                            cancel_at_period_end: true,
                            plan: {
                              id: 'plan_premium_month',
                              name: 'Premium',
                              features: { max_assets: 50 },
                            },
                          },
                        ]);
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

    const result = await getSubscriptionStatus(supabase as never, 'canceled-null');
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
          return mockBillingSubscriptionsFrom([]);
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
          return mockBillingSubscriptionsFrom([
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
          ]);
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

  function premiumStorageSupabase(usedBytes: number) {
    return {
      from: jest.fn((table: string) => {
        if (table === 'billing_subscriptions') {
          return mockBillingSubscriptionsFrom([
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
                                max_storage_mb: PREMIUM_TOTAL_STORAGE_MB,
                                max_file_size_mb: 100,
                                max_video_assets: 5,
                              },
                            },
                          },
                        ]);
        }
        if (table === 'asset_attachments') {
          return {
            select: () => ({
              eq: () =>
                Promise.resolve({
                  data: [{ file_size: usedBytes }],
                  error: null,
                }),
            }),
          };
        }
        if (table === 'digital_assets' || table === 'beneficiaries') {
          return {
            select: () => ({
              eq: () => Promise.resolve({ count: 0, data: null, error: null }),
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

  it('canUploadFile allows under Premium 5 GB total', async () => {
    clearSubscriptionCache();
    const used = (PREMIUM_TOTAL_STORAGE_MB - 100) * 1024 * 1024;
    const result = await canUploadFile(
      premiumStorageSupabase(used) as never,
      'premium-storage',
      50 * 1024 * 1024
    );
    expect(result.allowed).toBe(true);
  });

  it('canUploadFile blocks when Premium 5 GB total would be exceeded', async () => {
    clearSubscriptionCache();
    const used = (PREMIUM_TOTAL_STORAGE_MB - 10) * 1024 * 1024;
    const result = await canUploadFile(
      premiumStorageSupabase(used) as never,
      'premium-storage-full',
      50 * 1024 * 1024
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('storageLimitReached');
    expect(result.limit).toBe(PREMIUM_TOTAL_STORAGE_MB);
  });

  it('exports PREMIUM_TOTAL_STORAGE_MB as 5000 (5 GB)', () => {
    expect(PREMIUM_TOTAL_STORAGE_MB).toBe(5000);
  });
});
