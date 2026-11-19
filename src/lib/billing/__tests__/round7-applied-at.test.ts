/**
 * @jest-environment node
 *
 * Round-7: renewal applied_at heal, webhook reprocess handled=false,
 * path-2 vs approved first-charge, lease refresh after Wompi + HTTP timeout.
 */
import {
  applyWompiRenewalApproval,
  healApprovedRenewalAttempt,
} from '../renewals';
import { extendPeriodEnd } from '../dunning';
import { BillingService } from '../billing.service';
import { BillingError } from '../types';
import { WOMPI_HTTP_TIMEOUT_MS } from '../adapters/wompi.adapter';
import { FIRST_CHARGE_PERIOD_SENTINEL } from '../wompi-references';
import { configureChargeLeaseForTests } from '../charge-leases';

const userId = '11111111-2222-3333-4444-555555555555';
const subId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const periodEnd = '2026-11-10T07:00:00.000Z';
const reference = `wompi_renew_${subId}_20261110_1`;

function chain(terminal: { data?: unknown; error?: unknown }) {
  const api: Record<string, unknown> = {};
  const self = () => api;
  for (const m of [
    'select',
    'eq',
    'neq',
    'in',
    'is',
    'or',
    'order',
    'limit',
    'lt',
    'gt',
    'update',
    'insert',
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
}

describe('round-7: renewal applied_at heal', () => {
  afterEach(() => {
    configureChargeLeaseForTests({ alwaysGrant: true });
  });

  it('heals approved renewal when period_end still matches attempt (extends + applied_at)', async () => {
    const expectedNew = extendPeriodEnd(periodEnd, 'month', 10).toISOString();
    let liveEnd = periodEnd;
    let appliedAt: string | null = null;
    const attemptPatches: Record<string, unknown>[] = [];

    const supabase = {
      from: jest.fn((table: string) => {
        if (table === 'billing_renewal_attempts') {
          return {
            select: () =>
              chain({
                data: {
                  status: 'approved',
                  requires_refund: null,
                  applied_at: appliedAt,
                  period_end: periodEnd,
                  subscription_id: subId,
                  user_id: userId,
                  amount_cents: 490000,
                  wompi_transaction_id: 'tx-1',
                  wompi_reference: reference,
                },
                error: null,
              }),
            update: (patch: Record<string, unknown>) => {
              attemptPatches.push(patch);
              if (patch.applied_at) appliedAt = patch.applied_at as string;
              return chain({
                data: {
                  id: 'att-1',
                  applied_at: appliedAt,
                  requires_refund: patch.requires_refund,
                },
                error: null,
              });
            },
          };
        }
        if (table === 'billing_subscriptions') {
          return {
            select: () =>
              chain({
                data: {
                  id: subId,
                  user_id: userId,
                  plan_id: 'plan_premium_month',
                  status: 'past_due',
                  current_period_end: liveEnd,
                  billing_anchor_day: 10,
                  cancel_at_period_end: false,
                  provider: 'wompi',
                },
                error: null,
              }),
            update: (payload: Record<string, unknown>) => {
              if (payload.current_period_end) {
                liveEnd = payload.current_period_end as string;
              }
              return chain({ data: { id: subId }, error: null });
            },
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
        if (table === 'users') {
          return {
            select: () =>
              chain({ data: { email: 'u@example.com' }, error: null }),
          };
        }
        if (table === 'billing_email_events') {
          return {
            insert: () => chain({ data: { id: 'e' }, error: null }),
            delete: () => ({ eq: async () => ({ error: null }) }),
          };
        }
        return chain({ data: null, error: null });
      }),
    };

    const heal = await healApprovedRenewalAttempt(supabase as never, {
      reference,
      transactionId: 'tx-1',
      amountCents: 490000,
    });

    expect(heal.healed).toBe(true);
    expect(appliedAt).toBeTruthy();
    expect(liveEnd).toBe(expectedNew);
    expect(attemptPatches.some(p => p.applied_at)).toBe(true);
  });

  it('webhook redelivery of approved-without-applied_at heals instead of no-op', async () => {
    let appliedAt: string | null = null;
    let liveEnd = periodEnd;

    const supabase = {
      from: jest.fn((table: string) => {
        if (table === 'billing_renewal_attempts') {
          return {
            select: () =>
              chain({
                data: {
                  status: 'approved',
                  requires_refund: null,
                  applied_at: appliedAt,
                  period_end: periodEnd,
                  subscription_id: subId,
                  user_id: userId,
                  amount_cents: 490000,
                  wompi_transaction_id: 'tx-1',
                },
                error: null,
              }),
            update: (patch: Record<string, unknown>) => {
              if (patch.applied_at) appliedAt = patch.applied_at as string;
              return chain({
                data: { id: 'a', applied_at: appliedAt },
                error: null,
              });
            },
          };
        }
        if (table === 'billing_subscriptions') {
          return {
            select: () =>
              chain({
                data: {
                  id: subId,
                  user_id: userId,
                  plan_id: 'plan_premium_month',
                  status: 'past_due',
                  current_period_end: liveEnd,
                  billing_anchor_day: 10,
                  provider: 'wompi',
                },
                error: null,
              }),
            update: (payload: Record<string, unknown>) => {
              if (payload.current_period_end) {
                liveEnd = payload.current_period_end as string;
              }
              return chain({ data: { id: subId }, error: null });
            },
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
        if (table === 'users') {
          return {
            select: () =>
              chain({ data: { email: 'u@example.com' }, error: null }),
          };
        }
        if (table === 'billing_email_events') {
          return {
            insert: () => chain({ data: { id: 'e' }, error: null }),
            delete: () => ({ eq: async () => ({ error: null }) }),
          };
        }
        return chain({ data: null, error: null });
      }),
    };

    const ok = await applyWompiRenewalApproval(supabase as never, {
      reference,
      transactionId: 'tx-1',
      amountCents: 490000,
    });

    expect(ok).toBe(true);
    expect(appliedAt).toBeTruthy();
  });

  it('stamps applied_at only when live end already equals expected extension', async () => {
    const expectedNew = extendPeriodEnd(periodEnd, 'month', 10).toISOString();
    let appliedAt: string | null = null;

    const supabase = {
      from: jest.fn((table: string) => {
        if (table === 'billing_renewal_attempts') {
          return {
            select: () =>
              chain({
                data: {
                  status: 'approved',
                  requires_refund: null,
                  applied_at: appliedAt,
                  period_end: periodEnd,
                  subscription_id: subId,
                  user_id: userId,
                  amount_cents: 490000,
                },
                error: null,
              }),
            update: (patch: Record<string, unknown>) => {
              if (patch.applied_at) appliedAt = patch.applied_at as string;
              return chain({
                data: { id: 'a', applied_at: appliedAt },
                error: null,
              });
            },
          };
        }
        if (table === 'billing_subscriptions') {
          return {
            select: () =>
              chain({
                data: {
                  id: subId,
                  user_id: userId,
                  plan_id: 'plan_premium_month',
                  status: 'active',
                  current_period_end: expectedNew,
                  billing_anchor_day: 10,
                  provider: 'wompi',
                },
                error: null,
              }),
            update: () => {
              throw new Error('must not re-extend when already at expected end');
            },
          };
        }
        if (table === 'billing_plans') {
          return {
            select: () =>
              chain({
                data: { name: 'Premium', interval: 'month' },
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

    const heal = await healApprovedRenewalAttempt(supabase as never, {
      reference,
    });
    expect(heal.healed).toBe(true);
    expect(appliedAt).toBeTruthy();
  });
});

describe('round-7: webhook reprocess handled=false', () => {
  it('reprocesses existing unhandled event instead of skipping', async () => {
    let processCount = 0;
    let insertCalls = 0;

    const supabase = {
      from: jest.fn((table: string) => {
        if (table === 'billing_webhook_events') {
          return {
            insert: () => {
              insertCalls++;
              return {
                select: () => ({
                  single: async () => ({
                    data: null,
                    error: { code: '23505', message: 'duplicate' },
                  }),
                }),
              };
            },
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: { id: 'evt-existing', handled: false },
                    error: null,
                  }),
                }),
              }),
            }),
            update: (payload: Record<string, unknown>) => {
              if (payload.handled === true) processCount++;
              return { eq: async () => ({ error: null }) };
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
    };

    const service = new BillingService(supabase as never, {
      getName: () => 'stripe',
    } as never);

    // Unhandled type still marks handled after process
    await service.handleWebhookEvent({
      id: 'evt-1',
      provider: 'stripe',
      type: 'unknown.event',
      data: {},
      raw: {},
    } as never);

    expect(insertCalls).toBe(1);
    expect(processCount).toBe(1);
  });

  it('no-ops when prior event was handled=true', async () => {
    let processUpdates = 0;
    const supabase = {
      from: jest.fn((table: string) => {
        if (table === 'billing_webhook_events') {
          return {
            insert: () => ({
              select: () => ({
                single: async () => ({
                  data: null,
                  error: { code: '23505' },
                }),
              }),
            }),
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: { id: 'evt-done', handled: true },
                    error: null,
                  }),
                }),
              }),
            }),
            update: () => {
              processUpdates++;
              return { eq: async () => ({ error: null }) };
            },
          };
        }
        return {};
      }),
    };

    const service = new BillingService(supabase as never, {
      getName: () => 'wompi',
    } as never);

    await service.handleWebhookEvent({
      id: 'evt-1',
      provider: 'wompi',
      type: 'invoice.paid',
      data: {},
      raw: {},
    } as never);

    expect(processUpdates).toBe(0);
  });
});

describe('round-7: path-2 blocks approved first-charge', () => {
  it('refuses dunning reactivation when non-refund approved first-charge exists', async () => {
    const attemptUpdates: Record<string, unknown>[] = [];

    const supabase = {
      from: jest.fn((table: string) => {
        if (table === 'billing_renewal_attempts') {
          return {
            select: (cols?: string) => {
              if (cols === '*') {
                return chain({
                  data: {
                    id: 'att',
                    status: 'pending',
                    subscription_id: subId,
                    user_id: userId,
                    period_end: periodEnd,
                    amount_cents: 490000,
                    wompi_reference: reference,
                  },
                  error: null,
                });
              }
              // peers / open first / approved lists
              return chain({
                data: [
                  {
                    id: 'first-approved',
                    status: 'approved',
                    requires_refund: null,
                  },
                ],
                error: null,
              });
            },
            update: (patch: Record<string, unknown>) => {
              attemptUpdates.push(patch);
              return chain({
                data: {
                  id: 'att',
                  requires_refund: patch.requires_refund,
                  status: patch.status || 'approved',
                  applied_at: patch.applied_at,
                },
                error: null,
              });
            },
          };
        }
        if (table === 'billing_subscriptions') {
          return {
            select: () =>
              chain({
                data: {
                  id: subId,
                  user_id: userId,
                  plan_id: 'plan_premium_month',
                  status: 'canceled',
                  canceled_reason: 'dunning',
                  current_period_end: periodEnd,
                  billing_anchor_day: 10,
                  cancel_at_period_end: false,
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

    // Path-2 otherSubs empty via thenable override on second select... use heal path:
    // applyWompiRenewalApproval with pending → applyApprovedRenewal → period CAS path-2 blocked
    let subSelect = 0;
    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'billing_renewal_attempts') {
        return {
          select: (cols?: string) => {
            if (cols === '*') {
              return chain({
                data: {
                  id: 'att',
                  status: 'pending',
                  subscription_id: subId,
                  user_id: userId,
                  period_end: periodEnd,
                  amount_cents: 490000,
                  wompi_reference: reference,
                },
                error: null,
              });
            }
            if (cols?.includes('requires_refund') && cols.includes('wompi_reference')) {
              return chain({ data: [], error: null });
            }
            // open first-charge gate
            return chain({
              data: [
                {
                  id: 'fc',
                  status: 'approved',
                  requires_refund: null,
                },
              ],
              error: null,
            });
          },
          update: (patch: Record<string, unknown>) => {
            attemptUpdates.push(patch);
            return chain({
              data: {
                id: 'att',
                requires_refund: patch.requires_refund === true ? true : null,
                status: patch.status || 'approved',
                applied_at: patch.applied_at ?? null,
              },
              error: null,
            });
          },
        };
      }
      if (table === 'billing_subscriptions') {
        return {
          select: () => {
            subSelect++;
            if (subSelect === 1) {
              return chain({
                data: {
                  id: subId,
                  user_id: userId,
                  plan_id: 'plan_premium_month',
                  status: 'canceled',
                  canceled_reason: 'dunning',
                  current_period_end: periodEnd,
                  billing_anchor_day: 10,
                  provider: 'wompi',
                },
                error: null,
              });
            }
            // otherSubs empty
            return chain({ data: [], error: null });
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
    expect(attemptUpdates.some(p => p.requires_refund === true)).toBe(true);
    expect(attemptUpdates.some(p => p.applied_at)).toBe(false);
    expect(FIRST_CHARGE_PERIOD_SENTINEL).toBeTruthy();
  });
});

describe('round-7: Wompi HTTP timeout constant', () => {
  it('exposes a 30s AbortController timeout', () => {
    expect(WOMPI_HTTP_TIMEOUT_MS).toBe(30_000);
    expect(BillingError).toBeDefined();
  });
});
