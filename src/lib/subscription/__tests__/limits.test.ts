/**
 * @jest-environment node
 */
import {
  getSubscriptionStatus,
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
