/**
 * @jest-environment node
 *
 * Round-8: CAPE cancel CAS after resume, timestamptz sameInstant heal,
 * hard-stop any APPROVED (incl. requires_refund), canceled_reason=user.
 */
import {
  processWompiRenewals,
  healApprovedRenewalAttempt,
} from '../renewals';
import { extendPeriodEnd, sameInstant, toEpochMs } from '../dunning';
import { BillingService } from '../billing.service';
import { configureChargeLeaseForTests } from '../charge-leases';

const userId = '11111111-2222-3333-4444-555555555555';
const subId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const periodEnd = '2026-11-10T07:00:00.000Z';
const periodEndPlus00 = '2026-11-10T07:00:00+00:00';
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
    'lte',
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

describe('round-8: sameInstant / toEpochMs', () => {
  it('treats +00:00 and .000Z as the same instant', () => {
    expect(sameInstant(periodEnd, periodEndPlus00)).toBe(true);
    expect(toEpochMs(periodEnd)).toBe(toEpochMs(periodEndPlus00));
  });

  it('rejects distinct instants', () => {
    expect(sameInstant(periodEnd, '2026-11-10T07:00:01.000Z')).toBe(false);
  });
});

describe('round-8: CAPE cancel CAS after resume', () => {
  afterEach(() => {
    configureChargeLeaseForTests({ alwaysGrant: true });
  });

  it('no-ops when user resumed (cancel_at_period_end cleared under lease)', async () => {
    const emailSender = { send: jest.fn(async () => ({ sent: true })) };
    const now = new Date('2026-11-11T08:00:00.000Z');
    // Batch still sees CAPE scheduled
    const batchSub = {
      id: subId,
      user_id: userId,
      plan_id: 'plan_premium_month',
      status: 'active',
      cancel_at_period_end: true,
      current_period_end: periodEnd,
      current_period_start: '2026-10-10T07:00:00.000Z',
      provider: 'wompi',
    };
    // Live under lease: user resumed
    const liveResumed = {
      ...batchSub,
      cancel_at_period_end: false,
    };

    const cancelUpdates: Record<string, unknown>[] = [];
    const casFilters: string[] = [];

    const supabase = {
      from: jest.fn((table: string) => {
        if (table === 'billing_subscriptions') {
          return {
            select: () => {
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
                return { data: [batchSub], error: null };
              });
              node.maybeSingle = jest.fn(async () => ({
                data: liveResumed,
                error: null,
              }));
              return node;
            },
            update: (payload: Record<string, unknown>) => {
              cancelUpdates.push(payload);
              const node: Record<string, unknown> = {};
              const self = () => node;
              node.eq = jest.fn((col: string) => {
                casFilters.push(col);
                return node;
              });
              node.in = jest.fn((col: string) => {
                casFilters.push(`in:${col}`);
                return node;
              });
              node.select = jest.fn(self);
              // CAS miss — CAPE no longer true
              node.maybeSingle = jest.fn(async () => ({
                data: null,
                error: null,
              }));
              return node;
            },
          };
        }
        return chain({ data: null, error: null });
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

    expect(summary.canceledAtPeriodEnd).toBe(0);
    expect(wompi.createSourceTransaction).not.toHaveBeenCalled();
    // Live CAPE=false → skip before attempting cancel update
    expect(cancelUpdates).toHaveLength(0);
  });

  it('CAS-cancels only when live CAPE still true with matching period', async () => {
    const emailSender = { send: jest.fn(async () => ({ sent: true })) };
    const now = new Date('2026-11-11T08:00:00.000Z');
    const capeSub = {
      id: subId,
      user_id: userId,
      plan_id: 'plan_premium_month',
      status: 'active',
      cancel_at_period_end: true,
      current_period_end: periodEnd,
      current_period_start: '2026-10-10T07:00:00.000Z',
      provider: 'wompi',
    };

    const casEqCols: string[] = [];
    const canceledPayloads: Record<string, unknown>[] = [];

    const supabase = {
      from: jest.fn((table: string) => {
        if (table === 'billing_subscriptions') {
          return {
            select: () => {
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
                return { data: [capeSub], error: null };
              });
              node.maybeSingle = jest.fn(async () => ({
                data: capeSub,
                error: null,
              }));
              return node;
            },
            update: (payload: Record<string, unknown>) => {
              canceledPayloads.push(payload);
              const node: Record<string, unknown> = {};
              const self = () => node;
              node.eq = jest.fn((col: string, val?: unknown) => {
                casEqCols.push(col);
                if (col === 'current_period_end') {
                  expect(val).toBe(periodEnd);
                }
                if (col === 'cancel_at_period_end') {
                  expect(val).toBe(true);
                }
                return node;
              });
              node.in = jest.fn((col: string, vals: string[]) => {
                casEqCols.push(`in:${col}`);
                expect(vals).toEqual(expect.arrayContaining(['active', 'past_due']));
                return node;
              });
              node.select = jest.fn(self);
              node.maybeSingle = jest.fn(async () => ({
                data: { id: subId },
                error: null,
              }));
              return node;
            },
          };
        }
        return chain({ data: null, error: null });
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

    expect(summary.canceledAtPeriodEnd).toBe(1);
    expect(canceledPayloads[0]?.status).toBe('canceled');
    expect(canceledPayloads[0]?.canceled_reason).toBe('user');
    expect(casEqCols).toContain('cancel_at_period_end');
    expect(casEqCols).toContain('current_period_end');
    expect(casEqCols).toContain('in:status');
    expect(wompi.createSourceTransaction).not.toHaveBeenCalled();
  });
});

describe('round-8: heal timestamptz +00:00 vs .000Z', () => {
  it('marks applied_at when live end matches expected via sameInstant (+00:00 form)', async () => {
    const expectedNew = extendPeriodEnd(periodEnd, 'month', 10).toISOString();
    // PostgREST-style offset form of the already-extended period
    const liveEndPlus00 = expectedNew.replace('.000Z', '+00:00');
    expect(sameInstant(liveEndPlus00, expectedNew)).toBe(true);

    let appliedAt: string | null = null;
    let requiresRefund: boolean | null = null;

    const supabase = {
      from: jest.fn((table: string) => {
        if (table === 'billing_renewal_attempts') {
          return {
            select: () =>
              chain({
                data: {
                  status: 'approved',
                  requires_refund: null,
                  applied_at: null,
                  period_end: periodEnd,
                  subscription_id: subId,
                  user_id: userId,
                  amount_cents: 990000,
                  wompi_transaction_id: 'tx-1',
                  wompi_reference: reference,
                },
                error: null,
              }),
            update: (patch: Record<string, unknown>) => {
              if (patch.applied_at) appliedAt = patch.applied_at as string;
              if (patch.requires_refund === true) requiresRefund = true;
              return chain({
                data: {
                  id: 'att-1',
                  applied_at: appliedAt,
                  requires_refund: requiresRefund,
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
                  status: 'active',
                  current_period_end: liveEndPlus00,
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
                  provider_price_map: { wompi: '990000' },
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

    const heal = await healApprovedRenewalAttempt(supabase as never, {
      reference,
      transactionId: 'tx-1',
      amountCents: 990000,
    });

    expect(heal.healed).toBe(true);
    expect(heal.refunded).toBe(false);
    expect(appliedAt).toBeTruthy();
    expect(requiresRefund).toBeNull();
  });

  it('CAS period extend uses exact DB period string (+00:00), not re-serialized Z', async () => {
    const liveEndDb = periodEndPlus00;
    let casPeriodArg: string | null = null;

    const supabase = {
      from: jest.fn((table: string) => {
        if (table === 'billing_renewal_attempts') {
          return {
            select: () =>
              chain({
                data: {
                  status: 'approved',
                  requires_refund: null,
                  applied_at: null,
                  period_end: periodEnd,
                  subscription_id: subId,
                  user_id: userId,
                  amount_cents: 990000,
                  wompi_transaction_id: 'tx-1',
                  wompi_reference: reference,
                },
                error: null,
              }),
            update: (patch: Record<string, unknown>) =>
              chain({
                data: {
                  id: 'att-1',
                  applied_at: patch.applied_at ?? null,
                },
                error: null,
              }),
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
                  current_period_end: liveEndDb,
                  billing_anchor_day: 10,
                  cancel_at_period_end: false,
                  provider: 'wompi',
                },
                error: null,
              }),
            update: (payload: Record<string, unknown>) => {
              const node: Record<string, unknown> = {};
              const self = () => node;
              node.eq = jest.fn((col: string, val?: unknown) => {
                if (col === 'current_period_end') {
                  casPeriodArg = val as string;
                }
                return node;
              });
              node.in = jest.fn(self);
              node.select = jest.fn(self);
              node.maybeSingle = jest.fn(async () => {
                if (payload.current_period_end) {
                  return { data: { id: subId }, error: null };
                }
                return { data: null, error: null };
              });
              return node;
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
                  provider_price_map: { wompi: '990000' },
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
      amountCents: 990000,
    });

    expect(heal.healed).toBe(true);
    // Exact DB value, not Date#toISOString() re-serialization of the attempt period
    expect(casPeriodArg).toBe(liveEndDb);
  });
});

describe('round-8: hard-stop any APPROVED for period', () => {
  afterEach(() => {
    configureChargeLeaseForTests({ alwaysGrant: true });
  });

  it('does not open attempt N+1 when approved+requires_refund exists', async () => {
    const emailSender = { send: jest.fn(async () => ({ sent: true })) };
    // Day 1 → dueAttempt 2
    const now = new Date('2026-11-11T08:00:00.000Z');
    const liveSub = {
      id: subId,
      user_id: userId,
      plan_id: 'plan_premium_month',
      status: 'past_due',
      cancel_at_period_end: false,
      current_period_end: periodEnd,
      current_period_start: '2026-10-10T07:00:00.000Z',
      billing_anchor_day: 10,
      provider: 'wompi',
    };

    let claimInserts = 0;
    let attemptSelectRound = 0;

    const supabase = {
      from: jest.fn((table: string) => {
        if (table === 'billing_subscriptions') {
          return {
            select: () => {
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
                return { data: [liveSub], error: null };
              });
              node.maybeSingle = jest.fn(async () => ({
                data: liveSub,
                error: null,
              }));
              return node;
            },
            update: () => chain({ data: null, error: null }),
          };
        }
        if (table === 'billing_renewal_attempts') {
          return {
            select: () => {
              attemptSelectRound++;
              const node: Record<string, unknown> = {};
              const self = () => node;
              node.eq = jest.fn(self);
              node.in = jest.fn((col: string, vals: string[]) => {
                // pending/claimed reconcile query
                if (col === 'status' && vals.includes('claimed')) {
                  node.limit = jest.fn(async () => ({ data: [], error: null }));
                  (node as { then?: unknown }).then = (
                    resolve: (v: unknown) => unknown,
                    reject?: (e: unknown) => unknown
                  ) =>
                    Promise.resolve({ data: [], error: null }).then(
                      resolve,
                      reject
                    );
                }
                return node;
              });
              node.order = jest.fn(() => {
                (node as { then?: unknown }).then = (
                  resolve: (v: unknown) => unknown,
                  reject?: (e: unknown) => unknown
                ) =>
                  Promise.resolve({
                    data: [
                      {
                        attempt_number: 1,
                        status: 'approved',
                      },
                    ],
                    error: null,
                  }).then(resolve, reject);
                return node;
              });
              node.limit = jest.fn(async () => {
                // approved hard-stop query
                return {
                  data: [
                    {
                      id: 'att-approved',
                      requires_refund: true,
                      applied_at: null,
                      wompi_reference: reference,
                      wompi_transaction_id: 'tx-refund',
                      amount_cents: 990000,
                    },
                  ],
                  error: null,
                };
              });
              // Default thenable for pending query (no .in yet)
              (node as { then?: unknown }).then = (
                resolve: (v: unknown) => unknown,
                reject?: (e: unknown) => unknown
              ) =>
                Promise.resolve({ data: [], error: null }).then(resolve, reject);
              return node;
            },
            insert: async () => {
              claimInserts++;
              return { error: null };
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
                  provider_price_map: { wompi: '990000' },
                },
                error: null,
              }),
          };
        }
        return chain({ data: null, error: null });
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

    expect(claimInserts).toBe(0);
    expect(wompi.createSourceTransaction).not.toHaveBeenCalled();
    expect(summary.charged).toBe(0);
    expect(summary.skipped).toBeGreaterThanOrEqual(1);
    expect(attemptSelectRound).toBeGreaterThan(0);
  });
});

describe('round-8: immediate cancel canceled_reason=user', () => {
  it('sets canceled_reason user on atPeriodEnd=false', async () => {
    const updates: Record<string, unknown>[] = [];
    const supabase = {
      from: jest.fn((table: string) => {
        if (table === 'billing_subscriptions') {
          return {
            select: () =>
              chain({
                data: {
                  id: subId,
                  user_id: userId,
                  plan_id: 'plan_premium_month',
                  status: 'active',
                  provider: 'wompi',
                  provider_subscription_id: null,
                  cancel_at_period_end: false,
                  current_period_end: periodEnd,
                },
                error: null,
              }),
            update: (payload: Record<string, unknown>) => {
              updates.push(payload);
              return chain({ data: { id: subId }, error: null });
            },
          };
        }
        return chain({ data: null, error: null });
      }),
    };

    const gateway = {
      getName: () => 'wompi' as const,
      cancelSubscription: jest.fn(async () => undefined),
    };

    const service = new BillingService(supabase as never, gateway as never);
    await service.cancelSubscription({
      subscriptionId: subId,
      atPeriodEnd: false,
    });

    expect(updates.length).toBeGreaterThan(0);
    expect(updates[0].status).toBe('canceled');
    expect(updates[0].canceled_reason).toBe('user');
    expect(updates[0].canceled_at).toBeTruthy();
  });
});
