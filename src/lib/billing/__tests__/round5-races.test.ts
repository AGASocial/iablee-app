/**
 * @jest-environment node
 *
 * Round-5 cross-flow race coverage:
 * - cron after tombstone + new activation → no charge
 * - path-2 vs incomplete
 * - concurrent dual subscribe (second in-progress)
 * - tombstone blocked while approved exists
 * - lease contention (cron skip / subscribe 409)
 * - approved never reverted to claimed on period-CAS failure
 */
import {
  processWompiRenewals,
  applyWompiRenewalApproval,
  REQUIRES_REFUND_FLAG_PENDING,
} from '../renewals';
import {
  createWompiSourceAndSubscribe,
  findBlockingSubscription,
} from '../wompi-subscribe';
import { acquireChargeLease } from '../charge-leases';
import { BillingError } from '../types';

const userId = '11111111-2222-3333-4444-555555555555';
const planId = 'plan_premium_month';
const oldSubId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const newSubId = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff';
const periodEnd = '2026-11-10T07:00:00.000Z';

const plan = {
  id: planId,
  name: 'Premium',
  currency: 'USD' as const,
  amountCents: 999,
  interval: 'month' as const,
  features: {
    max_assets: -1,
    max_beneficiaries: 10,
    max_file_size_mb: 100,
    max_storage_mb: 5000,
    priority_support: true,
    advanced_security: true,
  },
  providerPriceMap: { wompi: '490000' },
};

function makeLiveSubSelect(liveSub: Record<string, unknown> | null) {
  return () => {
    const node: Record<string, unknown> = {};
    const self = () => node;
    let afterNeq = false;
    node.eq = jest.fn(self);
    node.in = jest.fn(self);
    node.lte = jest.fn(self);
    node.or = jest.fn(self);
    node.neq = jest.fn(() => {
      afterNeq = true;
      return node;
    });
    node.order = jest.fn(self);
    node.limit = jest.fn(async () => {
      if (afterNeq) {
        afterNeq = false;
        return { data: [], error: null };
      }
      return { data: liveSub ? [liveSub] : [], error: null };
    });
    node.maybeSingle = jest.fn(async () => ({
      data: liveSub,
      error: null,
    }));
    return node;
  };
}

describe('round-5: cron after tombstone + new activation', () => {
  it('does not charge a batch row that was tombstoned under lease re-read', async () => {
    const emailSender = { send: jest.fn(async () => ({ sent: true })) };
    const now = new Date('2026-11-11T08:00:00.000Z');
    // Batch still sees the old row as active; live re-read sees canceled tombstone
    const batchSub = {
      id: oldSubId,
      user_id: userId,
      plan_id: planId,
      status: 'active',
      cancel_at_period_end: false,
      current_period_end: periodEnd,
      provider: 'wompi',
    };
    const liveTombstone = {
      ...batchSub,
      status: 'canceled',
      canceled_reason: 'expired_resubscribe',
      cancel_at_period_end: true,
    };

    let selectCalls = 0;
    const supabase = {
      from: jest.fn((table: string) => {
        if (table === 'billing_subscriptions') {
          return {
            select: () => {
              selectCalls++;
              const node: Record<string, unknown> = {};
              const self = () => node;
              let afterNeq = false;
              node.eq = jest.fn(self);
              node.in = jest.fn(self);
              node.lte = jest.fn(self);
              node.or = jest.fn(self);
              node.neq = jest.fn(() => {
                afterNeq = true;
                return node;
              });
              node.order = jest.fn(self);
              node.limit = jest.fn(async () => {
                if (afterNeq) return { data: [], error: null };
                // due batch
                return { data: [batchSub], error: null };
              });
              node.maybeSingle = jest.fn(async () => ({
                data: liveTombstone,
                error: null,
              }));
              return node;
            },
          };
        }
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        };
      }),
      rpc: jest.fn(async () => ({ data: true, error: null })),
    };

    const wompi = {
      createSourceTransaction: jest.fn(),
      getTransaction: jest.fn(),
      findTransactionByReference: jest.fn(),
      waitForTransactionStatus: jest.fn(),
    };

    const summary = await processWompiRenewals(supabase as never, wompi as never, {
      now,
      emailSender,
      timeBudgetMs: 30_000,
    });

    expect(wompi.createSourceTransaction).not.toHaveBeenCalled();
    expect(summary.skipped).toBeGreaterThanOrEqual(1);
    expect(selectCalls).toBeGreaterThan(0);
  });
});

describe('round-5: path-2 vs incomplete', () => {
  it('refuses dunning reactivation when an incomplete Wompi sub exists', async () => {
    const reference = `wompi_renew_${oldSubId}_20261110_1`;
    const attemptUpdates: Record<string, unknown>[] = [];

    const chain = (terminal: { data?: unknown; error?: unknown }) => {
      const api: Record<string, unknown> = {};
      const self = () => api;
      for (const m of ['select', 'eq', 'neq', 'in', 'is', 'order', 'limit', 'lt']) {
        api[m] = jest.fn(self);
      }
      api.maybeSingle = jest.fn(async () => terminal);
      (api as { then?: unknown }).then = (
        resolve: (v: unknown) => unknown,
        reject?: (e: unknown) => unknown
      ) => Promise.resolve(terminal).then(resolve, reject);
      return api;
    };

    const supabase = {
      rpc: jest.fn(async () => ({ data: true, error: null })),
      from: jest.fn((table: string) => {
        if (table === 'billing_renewal_attempts') {
          return {
            select: (cols?: string) => {
              if (cols === '*') {
                return chain({
                  data: {
                    id: 'att-1',
                    subscription_id: oldSubId,
                    user_id: userId,
                    period_end: periodEnd,
                    attempt_number: 1,
                    status: 'pending',
                    wompi_reference: reference,
                    amount_cents: 490000,
                    requires_refund: null,
                  },
                  error: null,
                });
              }
              if (cols?.includes('requires_refund')) {
                return chain({ data: [], error: null });
              }
              return chain({ data: null, error: null });
            },
            update: (patch: Record<string, unknown>) => {
              attemptUpdates.push(patch);
              return chain({ data: { id: 'att-1', requires_refund: patch.requires_refund }, error: null });
            },
          };
        }
        if (table === 'billing_subscriptions') {
          return {
            select: () =>
              chain({
                data: {
                  id: oldSubId,
                  user_id: userId,
                  plan_id: planId,
                  status: 'canceled',
                  canceled_reason: 'dunning',
                  current_period_end: periodEnd,
                  billing_anchor_day: 10,
                  cancel_at_period_end: false,
                  provider: 'wompi',
                },
                error: null,
              }),
            update: () =>
              chain({
                // path-1 and path-2 fail; otherSubs returns incomplete
                data: null,
                error: null,
              }),
          };
        }
        if (table === 'billing_plans') {
          return {
            select: () =>
              chain({
                data: {
                  name: 'Premium',
                  interval: 'month',
                  provider_price_map: { wompi: '490000' },
                },
                error: null,
              }),
          };
        }
        if (table === 'billing_invoices') {
          return {
            select: () => chain({ data: null, error: null }),
            insert: async () => ({ error: null }),
            update: () => chain({ data: null, error: null }),
          };
        }
        return chain({ data: null, error: null });
      }),
    };

    // Override subscriptions select for "otherSubs" list to return incomplete
    let subSelectN = 0;
    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'billing_renewal_attempts') {
        return {
          select: (cols?: string) => {
            if (cols === '*') {
              return chain({
                data: {
                  id: 'att-1',
                  subscription_id: oldSubId,
                  user_id: userId,
                  period_end: periodEnd,
                  attempt_number: 1,
                  status: 'pending',
                  wompi_reference: reference,
                  amount_cents: 490000,
                },
                error: null,
              });
            }
            if (cols?.includes('requires_refund') || cols?.includes('id, requires_refund')) {
              return chain({ data: [], error: null });
            }
            // open first-charge check
            return chain({ data: [], error: null });
          },
          update: (patch: Record<string, unknown>) => {
            attemptUpdates.push(patch);
            const row = {
              id: 'att-1',
              requires_refund: patch.requires_refund === true ? true : patch.requires_refund,
              status: patch.status || 'approved',
            };
            return chain({ data: row, error: null });
          },
        };
      }
      if (table === 'billing_subscriptions') {
        return {
          select: () => {
            subSelectN++;
            // first: load sub for approval; later: otherSubs / reload
            if (subSelectN === 1) {
              return chain({
                data: {
                  id: oldSubId,
                  user_id: userId,
                  plan_id: planId,
                  status: 'canceled',
                  canceled_reason: 'dunning',
                  current_period_end: periodEnd,
                  billing_anchor_day: 10,
                  cancel_at_period_end: false,
                  provider: 'wompi',
                },
                error: null,
              });
            }
            // otherSubs query is thenable list
            return chain({
              data: [{ id: newSubId, status: 'incomplete' }],
              error: null,
            });
          },
          update: () => chain({ data: null, error: null }),
        };
      }
      if (table === 'billing_plans') {
        return {
          select: () =>
            chain({
              data: {
                name: 'Premium',
                interval: 'month',
                provider_price_map: { wompi: '490000' },
              },
              error: null,
            }),
        };
      }
      if (table === 'billing_invoices') {
        return {
          select: () => chain({ data: null, error: null }),
          insert: async () => ({ error: null }),
          upsert: async () => ({ error: null }),
          update: () => chain({ data: null, error: null }),
        };
      }
      return chain({ data: null, error: null });
    });

    const ok = await applyWompiRenewalApproval(supabase as never, {
      reference,
      transactionId: 'tx-late',
      amountCents: 490000,
    });

    expect(ok).toBe(true);
    expect(
      attemptUpdates.some(
        p => p.status === 'approved' || p.requires_refund === true
      )
    ).toBe(true);
    expect(attemptUpdates.some(p => p.status === 'claimed')).toBe(false);
    expect(
      attemptUpdates.some(p => p.requires_refund === true)
    ).toBe(true);
  });
});

describe('round-5: concurrent dual subscribe', () => {
  it('maps incomplete unique 23505 to in-progress BillingError', async () => {
    const chain = (terminal: { data?: unknown; error?: unknown }) => {
      const api: Record<string, unknown> = {};
      const self = () => api;
      for (const m of [
        'select',
        'eq',
        'in',
        'order',
        'limit',
        'update',
        'insert',
        'is',
        'neq',
      ]) {
        api[m] = jest.fn(self);
      }
      api.maybeSingle = jest.fn(async () => terminal);
      api.single = jest.fn(async () => terminal);
      (api as { then?: unknown }).then = (
        resolve: (v: unknown) => unknown,
        reject?: (e: unknown) => unknown
      ) => Promise.resolve(terminal).then(resolve, reject);
      return api;
    };

    const supabase = {
      rpc: jest.fn(async () => ({ data: true, error: null })),
      from: jest.fn((table: string) => {
        if (table === 'billing_subscriptions') {
          return {
            select: () => chain({ data: [], error: null }),
            insert: () =>
              chain({
                data: null,
                error: { code: '23505', message: 'unique incomplete' },
              }),
            update: () => chain({ data: null, error: null }),
          };
        }
        return chain({ data: null, error: null });
      }),
    };

    await expect(
      createWompiSourceAndSubscribe(supabase as never, {
        createPaymentSource: jest.fn(),
        createSourceTransaction: jest.fn(),
      } as never, {
        userId,
        plan,
        email: 'a@b.com',
        paymentType: 'CARD',
        paymentToken: 'tok',
        acceptanceToken: 'acc',
        acceptPersonalAuth: 'pers',
      })
    ).rejects.toMatchObject({
      code: 'WOMPI_SUBSCRIBE_IN_PROGRESS',
    });
  });

  it('returns WOMPI_SUBSCRIBE_IN_PROGRESS when lease is not acquired', async () => {
    const { configureChargeLeaseForTests } = await import('../charge-leases');
    configureChargeLeaseForTests({});
    const supabase = {
      rpc: jest.fn(async () => ({ data: false, error: null })),
      from: jest.fn(),
    };

    await expect(
      createWompiSourceAndSubscribe(supabase as never, {
        createPaymentSource: jest.fn(),
        createSourceTransaction: jest.fn(),
      } as never, {
        userId,
        plan,
        email: 'a@b.com',
        paymentType: 'CARD',
        paymentToken: 'tok',
        acceptanceToken: 'acc',
        acceptPersonalAuth: 'pers',
      })
    ).rejects.toBeInstanceOf(BillingError);

    await expect(
      createWompiSourceAndSubscribe(supabase as never, {
        createPaymentSource: jest.fn(),
        createSourceTransaction: jest.fn(),
      } as never, {
        userId,
        plan,
        email: 'a@b.com',
        paymentType: 'CARD',
        paymentToken: 'tok',
        acceptanceToken: 'acc',
        acceptPersonalAuth: 'pers',
      })
    ).rejects.toMatchObject({ code: 'WOMPI_SUBSCRIBE_IN_PROGRESS' });

    configureChargeLeaseForTests({ alwaysGrant: true });
  });
});

describe('round-5: tombstone blocked while approved exists', () => {
  it('does not tombstone expired active when non-refund approved exists', async () => {
    const expired = new Date(Date.now() - 3 * 86400000).toISOString();
    const supabase = {
      from: jest.fn((table: string) => {
        if (table === 'billing_subscriptions') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  in: () => ({
                    order: () => ({
                      limit: async () => ({
                        data: [
                          {
                            id: oldSubId,
                            status: 'active',
                            current_period_end: expired,
                            plan_id: planId,
                          },
                        ],
                        error: null,
                      }),
                    }),
                  }),
                }),
              }),
            }),
            update: () => {
              throw new Error('must not tombstone while approved exists');
            },
          };
        }
        if (table === 'billing_renewal_attempts') {
          return {
            select: () => ({
              eq: () => ({
                in: () => ({
                  limit: async () => ({
                    data: [
                      {
                        id: 'a1',
                        status: 'approved',
                        requires_refund: null,
                      },
                    ],
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        return {};
      }),
    };

    const blocked = await findBlockingSubscription(supabase as never, userId);
    expect(blocked?.id).toBe(oldSubId);
  });
});

describe('round-5: lease contention cron skip', () => {
  it('skips renewal when charge lease is not acquired', async () => {
    const { configureChargeLeaseForTests } = await import('../charge-leases');
    configureChargeLeaseForTests({});
    const emailSender = { send: jest.fn(async () => ({ sent: true })) };
    const now = new Date('2026-11-11T08:00:00.000Z');
    const liveSub = {
      id: oldSubId,
      user_id: userId,
      plan_id: planId,
      status: 'past_due',
      cancel_at_period_end: false,
      current_period_end: periodEnd,
      provider: 'wompi',
    };

    const supabase = {
      rpc: jest.fn(async (fn: string) => {
        if (fn === 'acquire_billing_charge_lease') {
          return { data: false, error: null };
        }
        return { data: null, error: null };
      }),
      from: jest.fn((table: string) => {
        if (table === 'billing_subscriptions') {
          return { select: makeLiveSubSelect(liveSub) };
        }
        // first-charge heal + attempts
        const node: Record<string, unknown> = {};
        const self = () => node;
        node.eq = jest.fn(self);
        node.or = jest.fn(self);
        node.is = jest.fn(self);
        node.in = jest.fn(self);
        node.order = jest.fn(self);
        node.limit = jest.fn(async () => ({ data: [], error: null }));
        node.maybeSingle = jest.fn(async () => ({ data: null, error: null }));
        return {
          select: () => node,
        };
      }),
    };

    const wompi = {
      createSourceTransaction: jest.fn(),
      getTransaction: jest.fn(),
      findTransactionByReference: jest.fn(),
      waitForTransactionStatus: jest.fn(),
    };

    const summary = await processWompiRenewals(supabase as never, wompi as never, {
      now,
      emailSender,
      timeBudgetMs: 30_000,
    });

    expect(wompi.createSourceTransaction).not.toHaveBeenCalled();
    expect(summary.skipped).toBeGreaterThanOrEqual(1);
    expect(acquireChargeLease).toBeDefined();
    configureChargeLeaseForTests({ alwaysGrant: true });
  });
});

describe('round-5: approved never reverted', () => {
  it('keeps approved and sets requires_refund / PENDING marker on period-CAS failure', async () => {
    const reference = `wompi_renew_${oldSubId}_20261110_2`;
    const attemptPatches: Record<string, unknown>[] = [];

    const chain = (terminal: { data?: unknown; error?: unknown }) => {
      const api: Record<string, unknown> = {};
      const self = () => api;
      for (const m of ['select', 'eq', 'neq', 'in', 'is', 'order', 'limit', 'lt']) {
        api[m] = jest.fn(self);
      }
      api.maybeSingle = jest.fn(async () => terminal);
      (api as { then?: unknown }).then = (
        resolve: (v: unknown) => unknown,
        reject?: (e: unknown) => unknown
      ) => Promise.resolve(terminal).then(resolve, reject);
      return api;
    };

    let flagWriteFails = 0;
    const supabase = {
      rpc: jest.fn(async () => ({ data: true, error: null })),
      from: jest.fn((table: string) => {
        if (table === 'billing_renewal_attempts') {
          return {
            select: (cols?: string) => {
              if (cols === '*') {
                return chain({
                  data: {
                    id: 'att-2',
                    subscription_id: oldSubId,
                    user_id: userId,
                    period_end: periodEnd,
                    attempt_number: 2,
                    status: 'pending',
                    wompi_reference: reference,
                    amount_cents: 490000,
                  },
                  error: null,
                });
              }
              return chain({ data: [], error: null });
            },
            update: (patch: Record<string, unknown>) => {
              attemptPatches.push(patch);
              // First CAS to approved succeeds; requires_refund writes fail until marker
              if (patch.status === 'approved') {
                return chain({ data: { id: 'att-2' }, error: null });
              }
              if (patch.requires_refund === true) {
                flagWriteFails++;
                if (flagWriteFails <= 3) {
                  return chain({ data: null, error: null });
                }
                return chain({
                  data: { id: 'att-2', requires_refund: true },
                  error: null,
                });
              }
              if (patch.error_message === REQUIRES_REFUND_FLAG_PENDING) {
                return chain({ data: { id: 'att-2' }, error: null });
              }
              return chain({ data: { id: 'att-2' }, error: null });
            },
          };
        }
        if (table === 'billing_subscriptions') {
          return {
            select: () =>
              chain({
                data: {
                  id: oldSubId,
                  user_id: userId,
                  plan_id: planId,
                  status: 'canceled',
                  canceled_reason: 'expired_resubscribe',
                  current_period_end: periodEnd,
                  billing_anchor_day: 10,
                  cancel_at_period_end: true,
                  provider: 'wompi',
                },
                error: null,
              }),
            update: () => chain({ data: null, error: null }),
          };
        }
        if (table === 'billing_plans') {
          return {
            select: () =>
              chain({
                data: {
                  name: 'Premium',
                  interval: 'month',
                  provider_price_map: { wompi: '490000' },
                },
                error: null,
              }),
          };
        }
        if (table === 'billing_invoices') {
          return {
            select: () => chain({ data: null, error: null }),
            insert: async () => ({ error: null }),
            upsert: async () => ({ error: null }),
            update: () => chain({ data: null, error: null }),
          };
        }
        return chain({ data: null, error: null });
      }),
    };

    const ok = await applyWompiRenewalApproval(supabase as never, {
      reference,
      transactionId: 'tx-ok',
      amountCents: 490000,
    });

    expect(ok).toBe(true);
    expect(attemptPatches.some(p => p.status === 'claimed')).toBe(false);
    expect(
      attemptPatches.some(
        p =>
          p.requires_refund === true ||
          p.error_message === REQUIRES_REFUND_FLAG_PENDING
      )
    ).toBe(true);
  });
});
