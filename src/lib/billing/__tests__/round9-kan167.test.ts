/**
 * @jest-environment node
 *
 * KAN-167 / round-9 SHOULD-FIX + requires_refund alerting.
 */
import {
  processWompiRenewals,
  abandonUnsentClaim,
} from '../renewals';
import { activateFirstCharge } from '../wompi-subscribe';
import {
  alertRequiresRefundOnce,
  parseBillingAlertEmails,
  processRequiresRefundAlerts,
  refundSummaryPeriodKey,
  setAdminEmailSenderForTests,
  REFUND_ALERT_CLAIM_STALE_MS,
} from '../refund-alerts';
import { configureChargeLeaseForTests } from '../charge-leases';
import { BillingError } from '../types';
import { buildWompiRenewalReference } from '../wompi-references';

const userId = '11111111-2222-3333-4444-555555555555';
const subId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const periodEnd = '2026-11-10T07:00:00.000Z';
const reference = `wompi_renew_${subId}_20261110_1`;
const firstRef = `wompi_first_${userId}_plan_premium_month_${subId}_1`;

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
    'delete',
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

const premiumPlan = {
  id: 'plan_premium_month',
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
};

describe('round-9: CAPE CAS miss → fall through charge', () => {
  afterEach(() => {
    configureChargeLeaseForTests({ alwaysGrant: true });
  });

  it('re-reads after CAPE CAS miss and charges when user resumed', async () => {
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
    const resumed = { ...capeSub, cancel_at_period_end: false };

    let liveReads = 0;
    let claimInserted = false;
    const attemptSelectCalls: string[] = [];

    const supabase = {
      from: jest.fn((table: string) => {
        if (table === 'billing_subscriptions') {
          return {
            select: (cols?: string) => {
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
                // batch due scan
                return { data: [capeSub], error: null };
              });
              node.maybeSingle = jest.fn(async () => {
                liveReads++;
                // 1: initial live (CAPE true), 2: CAS-miss re-read (resumed),
                // 3+: locked re-validation (resumed)
                if (liveReads === 1) {
                  return { data: capeSub, error: null };
                }
                return { data: resumed, error: null };
              });
              void cols;
              return node;
            },
            update: () => {
              // CAPE cancel CAS miss
              const node: Record<string, unknown> = {};
              const self = () => node;
              node.eq = jest.fn(self);
              node.in = jest.fn(self);
              node.select = jest.fn(self);
              node.maybeSingle = jest.fn(async () => ({
                data: null,
                error: null,
              }));
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
                  provider_price_map: { wompi: 'wompi_premium_month' },
                },
                error: null,
              }),
          };
        }
        if (table === 'billing_payment_methods') {
          return {
            select: () =>
              chain({
                data: {
                  id: 'pm-1',
                  provider_payment_source_id: '55',
                  method_type: 'CARD',
                },
                error: null,
              }),
          };
        }
        if (table === 'users') {
          return {
            select: () =>
              chain({ data: { email: 'u@example.com' }, error: null }),
          };
        }
        if (table === 'billing_renewal_attempts') {
          return {
            select: (cols?: string) => {
              attemptSelectCalls.push(cols || '');
              // approved / prior / pending / refund sweep → empty
              const node: Record<string, unknown> = {};
              const self = () => node;
              for (const m of [
                'eq',
                'neq',
                'in',
                'is',
                'or',
                'order',
                'limit',
              ]) {
                node[m] = jest.fn(self);
              }
              node.maybeSingle = jest.fn(async () => ({
                data: null,
                error: null,
              }));
              (node as { then?: unknown }).then = (
                resolve: (v: unknown) => unknown,
                reject?: (e: unknown) => unknown
              ) =>
                Promise.resolve({ data: [], error: null }).then(
                  resolve,
                  reject
                );
              return node;
            },
            insert: () => {
              claimInserted = true;
              return {
                then: (
                  resolve: (v: unknown) => unknown,
                  reject?: (e: unknown) => unknown
                ) =>
                  Promise.resolve({ data: null, error: null }).then(
                    resolve,
                    reject
                  ),
              };
            },
            update: () => chain({ data: { id: 'att-1' }, error: null }),
            delete: () => chain({ data: null, error: null }),
          };
        }
        if (table === 'billing_email_events') {
          return {
            insert: () =>
              chain({
                data: null,
                error: { code: '23505', message: 'duplicate' },
              }),
            delete: () => chain({ data: null, error: null }),
          };
        }
        return chain({ data: null, error: null });
      }),
      rpc: jest.fn(async () => ({ data: true, error: null })),
    };

    const wompi = {
      createSourceTransaction: jest.fn(async () => ({
        id: 'tx-new',
        status: 'APPROVED',
        amountInCents: 990000,
      })),
      getTransaction: jest.fn(),
      findTransactionByReference: jest.fn(),
      waitForTransactionStatus: jest.fn(async () => ({
        id: 'tx-new',
        status: 'APPROVED',
        amountInCents: 990000,
      })),
    };

    const summary = await processWompiRenewals(supabase as never, wompi as never, {
      now,
      emailSender,
      timeBudgetMs: 30_000,
    });

    expect(summary.canceledAtPeriodEnd).toBe(0);
    expect(claimInserted).toBe(true);
    // Day-1 after period end → dunning attempt 2
    expect(wompi.createSourceTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        reference: `wompi_renew_${subId}_20261110_2`,
      })
    );
    expect(liveReads).toBeGreaterThanOrEqual(2);
  });
});

describe('round-9: eligibility read errors fail closed', () => {
  afterEach(() => {
    configureChargeLeaseForTests({ alwaysGrant: true });
  });

  it('skips charge when approvedRows query errors (does not treat as empty)', async () => {
    const emailSender = { send: jest.fn(async () => ({ sent: true })) };
    const now = new Date('2026-11-11T08:00:00.000Z');
    const dueSub = {
      id: subId,
      user_id: userId,
      plan_id: 'plan_premium_month',
      status: 'active',
      cancel_at_period_end: false,
      current_period_end: periodEnd,
      current_period_start: '2026-10-10T07:00:00.000Z',
      provider: 'wompi',
    };

    let insertCalled = false;

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
                if (afterNeq) return { data: [], error: null };
                return { data: [dueSub], error: null };
              });
              node.maybeSingle = jest.fn(async () => ({
                data: dueSub,
                error: null,
              }));
              return node;
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
                  provider_price_map: { wompi: 'wompi_premium_month' },
                },
                error: null,
              }),
          };
        }
        if (table === 'billing_renewal_attempts') {
          return {
            select: (cols?: string) => {
              const node: Record<string, unknown> = {};
              const self = () => node;
              for (const m of [
                'eq',
                'neq',
                'in',
                'is',
                'or',
                'order',
                'limit',
              ]) {
                node[m] = jest.fn(self);
              }
              node.maybeSingle = jest.fn(async () => ({
                data: null,
                error: null,
              }));
              (node as { then?: unknown }).then = (
                resolve: (v: unknown) => unknown,
                reject?: (e: unknown) => unknown
              ) => {
                // Approved hard-stop select includes requires_refund + applied_at
                if (
                  cols?.includes('requires_refund') &&
                  cols.includes('applied_at')
                ) {
                  return Promise.resolve({
                    data: null,
                    error: { message: 'postgrest boom' },
                  }).then(resolve, reject);
                }
                return Promise.resolve({ data: [], error: null }).then(
                  resolve,
                  reject
                );
              };
              return node;
            },
            insert: () => {
              insertCalled = true;
              return {
                then: (
                  resolve: (v: unknown) => unknown,
                  reject?: (e: unknown) => unknown
                ) =>
                  Promise.resolve({ data: null, error: null }).then(
                    resolve,
                    reject
                  ),
              };
            },
            update: () => chain({ data: null, error: null }),
            delete: () => chain({ data: null, error: null }),
          };
        }
        if (table === 'billing_email_events') {
          return {
            insert: () =>
              chain({
                data: null,
                error: { code: '23505', message: 'duplicate' },
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

    expect(insertCalled).toBe(false);
    expect(wompi.createSourceTransaction).not.toHaveBeenCalled();
    expect(summary.skipped).toBeGreaterThanOrEqual(1);
    expect(
      summary.errors.some(e =>
        e.message.includes('Approved attempts read failed')
      )
    ).toBe(true);
  });

  it('skips charge when priorAttempts query errors (does not treat as empty)', async () => {
    const emailSender = { send: jest.fn(async () => ({ sent: true })) };
    const now = new Date('2026-11-11T08:00:00.000Z');
    const dueSub = {
      id: subId,
      user_id: userId,
      plan_id: 'plan_premium_month',
      status: 'active',
      cancel_at_period_end: false,
      current_period_end: periodEnd,
      current_period_start: '2026-10-10T07:00:00.000Z',
      provider: 'wompi',
    };

    let insertCalled = false;

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
                if (afterNeq) return { data: [], error: null };
                return { data: [dueSub], error: null };
              });
              node.maybeSingle = jest.fn(async () => ({
                data: dueSub,
                error: null,
              }));
              return node;
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
                  provider_price_map: { wompi: 'wompi_premium_month' },
                },
                error: null,
              }),
          };
        }
        if (table === 'billing_renewal_attempts') {
          return {
            select: (cols?: string) => {
              const node: Record<string, unknown> = {};
              const self = () => node;
              for (const m of [
                'eq',
                'neq',
                'in',
                'is',
                'or',
                'order',
                'limit',
              ]) {
                node[m] = jest.fn(self);
              }
              node.maybeSingle = jest.fn(async () => ({
                data: null,
                error: null,
              }));
              (node as { then?: unknown }).then = (
                resolve: (v: unknown) => unknown,
                reject?: (e: unknown) => unknown
              ) => {
                // priorAttempts: attempt_number + status (no requires_refund/applied_at)
                if (
                  cols?.includes('attempt_number') &&
                  cols.includes('status') &&
                  !cols.includes('requires_refund')
                ) {
                  return Promise.resolve({
                    data: null,
                    error: { message: 'priorAttempts boom' },
                  }).then(resolve, reject);
                }
                return Promise.resolve({ data: [], error: null }).then(
                  resolve,
                  reject
                );
              };
              return node;
            },
            insert: () => {
              insertCalled = true;
              return {
                then: (
                  resolve: (v: unknown) => unknown,
                  reject?: (e: unknown) => unknown
                ) =>
                  Promise.resolve({ data: null, error: null }).then(
                    resolve,
                    reject
                  ),
              };
            },
            update: () => chain({ data: null, error: null }),
            delete: () => chain({ data: null, error: null }),
          };
        }
        if (table === 'billing_email_events') {
          return {
            insert: () =>
              chain({
                data: null,
                error: { code: '23505', message: 'duplicate' },
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

    expect(insertCalled).toBe(false);
    expect(wompi.createSourceTransaction).not.toHaveBeenCalled();
    expect(
      summary.errors.some(e =>
        e.message.includes('Prior attempts read failed')
      )
    ).toBe(true);
  });
});

describe('round-9: non-promotable first-charge → requires_refund + not retryable', () => {
  afterEach(() => {
    configureChargeLeaseForTests({ alwaysGrant: true });
  });

  it('flags requires_refund when sub is canceled and does not throw retryable', async () => {
    const refundPatches: Record<string, unknown>[] = [];
    let attemptStatus: string = 'claimed';
    let requiresRefund: boolean | null = null;

    const supabase = {
      from: jest.fn((table: string) => {
        if (table === 'billing_subscriptions') {
          return {
            select: () => {
              const node: Record<string, unknown> = {};
              const self = () => node;
              node.eq = jest.fn(self);
              node.neq = jest.fn(self);
              node.in = jest.fn(self);
              node.limit = jest.fn(async () => ({ data: [], error: null }));
              node.lt = jest.fn(self);
              node.maybeSingle = jest.fn(async () => ({
                data: {
                  id: subId,
                  status: 'canceled',
                  current_period_end: periodEnd,
                  billing_anchor_day: 10,
                  canceled_reason: 'user',
                },
                error: null,
              }));
              return node;
            },
            update: () => {
              const node: Record<string, unknown> = {};
              const self = () => node;
              node.eq = jest.fn(self);
              node.in = jest.fn(self);
              node.lt = jest.fn(self);
              node.select = jest.fn(self);
              // Promote CAS miss
              node.maybeSingle = jest.fn(async () => ({
                data: null,
                error: null,
              }));
              return node;
            },
          };
        }
        if (table === 'billing_renewal_attempts') {
          return {
            select: () =>
              chain({
                data: {
                  status: attemptStatus,
                  requires_refund: requiresRefund,
                },
                error: null,
              }),
            update: (patch: Record<string, unknown>) => {
              if (patch.status === 'approved') {
                attemptStatus = 'approved';
              }
              if (patch.requires_refund === true) {
                requiresRefund = true;
                refundPatches.push(patch);
              }
              return chain({
                data: {
                  id: 'att-1',
                  status: attemptStatus,
                  requires_refund: requiresRefund,
                },
                error: null,
              });
            },
          };
        }
        if (table === 'billing_invoices') {
          return {
            upsert: jest.fn(async () => ({ error: null })),
            select: () => chain({ data: null, error: null }),
            update: () => chain({ data: null, error: null }),
            insert: jest.fn(async () => ({ error: null })),
          };
        }
        return chain({ data: null, error: null });
      }),
      rpc: jest.fn(async () => ({ data: true, error: null })),
    };

    const result = await activateFirstCharge(supabase as never, {
      userId,
      subscriptionId: subId,
      plan: premiumPlan,
      reference: firstRef,
      transactionId: 'tx-first',
      amountInCents: 990000,
      email: 'u@example.com',
    });

    expect(result.activated).toBe(false);
    expect(result.retryable).toBeUndefined();
    expect(requiresRefund).toBe(true);
    expect(refundPatches.length).toBeGreaterThanOrEqual(1);

    // Public activateFirstCharge must not throw WOMPI_ACTIVATION_RETRY
    await expect(
      activateFirstCharge(supabase as never, {
        userId,
        subscriptionId: subId,
        plan: premiumPlan,
        reference: firstRef,
        transactionId: 'tx-first',
        amountInCents: 990000,
        email: 'u@example.com',
      })
    ).resolves.toEqual({ activated: false });
  });

  it('still throws WOMPI_ACTIVATION_RETRY for transient incomplete', async () => {
    const supabase = {
      from: jest.fn((table: string) => {
        if (table === 'billing_subscriptions') {
          return {
            select: () => {
              const node: Record<string, unknown> = {};
              const self = () => node;
              node.eq = jest.fn(self);
              node.neq = jest.fn(self);
              node.in = jest.fn(self);
              node.limit = jest.fn(async () => ({ data: [], error: null }));
              node.lt = jest.fn(self);
              node.maybeSingle = jest.fn(async () => ({
                data: {
                  id: subId,
                  status: 'incomplete',
                  current_period_end: null,
                  billing_anchor_day: null,
                },
                error: null,
              }));
              return node;
            },
            update: () => {
              const node: Record<string, unknown> = {};
              const self = () => node;
              node.eq = jest.fn(self);
              node.in = jest.fn(self);
              node.lt = jest.fn(self);
              node.select = jest.fn(self);
              // Promote CAS fails (transient)
              node.maybeSingle = jest.fn(async () => ({
                data: null,
                error: null,
              }));
              return node;
            },
          };
        }
        if (table === 'billing_renewal_attempts') {
          return {
            select: () =>
              chain({
                data: { status: 'approved', requires_refund: null },
                error: null,
              }),
            update: () =>
              chain({
                data: { id: 'att-1', status: 'approved', requires_refund: null },
                error: null,
              }),
          };
        }
        if (table === 'billing_invoices') {
          return {
            upsert: jest.fn(async () => ({ error: null })),
            select: () => chain({ data: null, error: null }),
            insert: jest.fn(async () => ({ error: null })),
          };
        }
        return chain({ data: null, error: null });
      }),
      rpc: jest.fn(async () => ({ data: true, error: null })),
    };

    await expect(
      activateFirstCharge(supabase as never, {
        userId,
        subscriptionId: subId,
        plan: premiumPlan,
        reference: firstRef,
        transactionId: 'tx-first',
        amountInCents: 990000,
        email: 'u@example.com',
      })
    ).rejects.toMatchObject({
      code: 'WOMPI_ACTIVATION_RETRY',
    } as Partial<BillingError>);
  });
});

describe('round-9: lease lost before/after Wompi call', () => {
  it('abandonUnsentClaim CAS filters status=claimed and wompi_transaction_id null', async () => {
    const eqFilters: Array<{ col: string; val: unknown }> = [];
    const isFilters: Array<{ col: string; val: unknown }> = [];
    const supabase = {
      from: jest.fn(() => ({
        delete: () => {
          const node: Record<string, unknown> = {};
          const self = () => node;
          node.eq = jest.fn((col: string, val: unknown) => {
            eqFilters.push({ col, val });
            return node;
          });
          node.is = jest.fn((col: string, val: unknown) => {
            isFilters.push({ col, val });
            return node;
          });
          node.select = jest.fn(self);
          node.maybeSingle = jest.fn(async () => ({
            data: { id: 'att-abandon' },
            error: null,
          }));
          return node;
        },
      })),
    };

    const ok = await abandonUnsentClaim(supabase as never, reference);
    expect(ok).toBe(true);
    expect(eqFilters).toEqual(
      expect.arrayContaining([
        { col: 'wompi_reference', val: reference },
        { col: 'status', val: 'claimed' },
      ])
    );
    expect(isFilters).toEqual(
      expect.arrayContaining([{ col: 'wompi_transaction_id', val: null }])
    );
  });

  it('lease lost before createSourceTransaction abandons claim; next run reuses same attempt/ref', async () => {
    const emailSender = { send: jest.fn(async () => ({ sent: true })) };
    const now = new Date('2026-11-11T08:00:00.000Z');
    const expectedRef = buildWompiRenewalReference(subId, periodEnd, 2);
    const dueSub = {
      id: subId,
      user_id: userId,
      plan_id: 'plan_premium_month',
      status: 'active',
      cancel_at_period_end: false,
      current_period_end: periodEnd,
      current_period_start: '2026-10-10T07:00:00.000Z',
      provider: 'wompi',
    };

    let abandoned = false;
    let insertCount = 0;
    /** Run 1 only: fail the pre-charge lease refresh after claim insert. */
    let failNextPreChargeRefresh = true;
    let pendingClaim = false;
    const insertedRefs: string[] = [];

    configureChargeLeaseForTests(null);

    const makeSupabase = () => ({
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
                if (afterNeq) return { data: [], error: null };
                return { data: [dueSub], error: null };
              });
              node.maybeSingle = jest.fn(async () => ({
                data: dueSub,
                error: null,
              }));
              return node;
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
                  provider_price_map: { wompi: 'wompi_premium_month' },
                },
                error: null,
              }),
          };
        }
        if (table === 'billing_payment_methods') {
          return {
            select: () =>
              chain({
                data: {
                  id: 'pm-1',
                  provider_payment_source_id: '55',
                  method_type: 'CARD',
                },
                error: null,
              }),
          };
        }
        if (table === 'users') {
          return {
            select: () =>
              chain({ data: { email: 'u@example.com' }, error: null }),
          };
        }
        if (table === 'billing_renewal_attempts') {
          return {
            select: () => {
              const node: Record<string, unknown> = {};
              const self = () => node;
              for (const m of [
                'eq',
                'neq',
                'in',
                'is',
                'or',
                'order',
                'limit',
              ]) {
                node[m] = jest.fn(self);
              }
              node.maybeSingle = jest.fn(async () => ({
                data: null,
                error: null,
              }));
              (node as { then?: unknown }).then = (
                resolve: (v: unknown) => unknown,
                reject?: (e: unknown) => unknown
              ) =>
                Promise.resolve({ data: [], error: null }).then(
                  resolve,
                  reject
                );
              return node;
            },
            insert: (row: Record<string, unknown>) => {
              insertCount++;
              pendingClaim = true;
              insertedRefs.push(String(row.wompi_reference));
              return {
                then: (
                  resolve: (v: unknown) => unknown,
                  reject?: (e: unknown) => unknown
                ) =>
                  Promise.resolve({ data: null, error: null }).then(
                    resolve,
                    reject
                  ),
              };
            },
            update: () => chain({ data: { id: 'att-1' }, error: null }),
            delete: () => {
              abandoned = true;
              pendingClaim = false;
              return chain({ data: { id: 'att-1' }, error: null });
            },
          };
        }
        if (table === 'billing_email_events') {
          return {
            insert: () =>
              chain({
                data: null,
                error: { code: '23505', message: 'duplicate' },
              }),
          };
        }
        return chain({ data: null, error: null });
      }),
      rpc: jest.fn(async (fn: string) => {
        if (fn === 'acquire_billing_charge_lease') {
          if (pendingClaim && failNextPreChargeRefresh) {
            failNextPreChargeRefresh = false;
            return { data: false, error: null };
          }
          return { data: true, error: null };
        }
        if (fn === 'release_billing_charge_lease') {
          return { data: true, error: null };
        }
        return { data: true, error: null };
      }),
    });

    const wompi = {
      createSourceTransaction: jest.fn(async () => ({
        id: 'tx-reuse',
        status: 'APPROVED',
        amountInCents: 990000,
      })),
      getTransaction: jest.fn(),
      findTransactionByReference: jest.fn(),
      waitForTransactionStatus: jest.fn(async () => ({
        id: 'tx-reuse',
        status: 'APPROVED',
        amountInCents: 990000,
      })),
    };

    const supabase1 = makeSupabase();
    const summary1 = await processWompiRenewals(
      supabase1 as never,
      wompi as never,
      { now, emailSender, timeBudgetMs: 30_000 }
    );

    expect(wompi.createSourceTransaction).not.toHaveBeenCalled();
    expect(abandoned).toBe(true);
    expect(insertCount).toBe(1);
    expect(insertedRefs[0]).toBe(expectedRef);
    expect(
      summary1.errors.some(e => e.message.includes('claim abandoned'))
    ).toBe(true);

    // Second renewal run: same attempt/reference proceeds to Wompi
    const supabase2 = makeSupabase();
    await processWompiRenewals(supabase2 as never, wompi as never, {
      now,
      emailSender,
      timeBudgetMs: 30_000,
    });

    expect(insertCount).toBe(2);
    expect(insertedRefs[1]).toBe(expectedRef);
    expect(wompi.createSourceTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ reference: expectedRef })
    );

    configureChargeLeaseForTests({ alwaysGrant: true });
  });

  it('lease lost after Wompi call keeps claim linked to tx id', async () => {
    const emailSender = { send: jest.fn(async () => ({ sent: true })) };
    const now = new Date('2026-11-11T08:00:00.000Z');
    const dueSub = {
      id: subId,
      user_id: userId,
      plan_id: 'plan_premium_month',
      status: 'active',
      cancel_at_period_end: false,
      current_period_end: periodEnd,
      current_period_start: '2026-10-10T07:00:00.000Z',
      provider: 'wompi',
    };

    let wompiCalled = false;
    const claimPatches: Record<string, unknown>[] = [];

    configureChargeLeaseForTests(null);

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
                if (afterNeq) return { data: [], error: null };
                return { data: [dueSub], error: null };
              });
              node.maybeSingle = jest.fn(async () => ({
                data: dueSub,
                error: null,
              }));
              return node;
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
                  provider_price_map: { wompi: 'wompi_premium_month' },
                },
                error: null,
              }),
          };
        }
        if (table === 'billing_payment_methods') {
          return {
            select: () =>
              chain({
                data: {
                  id: 'pm-1',
                  provider_payment_source_id: '55',
                  method_type: 'CARD',
                },
                error: null,
              }),
          };
        }
        if (table === 'users') {
          return {
            select: () =>
              chain({ data: { email: 'u@example.com' }, error: null }),
          };
        }
        if (table === 'billing_renewal_attempts') {
          return {
            select: () => {
              const node: Record<string, unknown> = {};
              const self = () => node;
              for (const m of [
                'eq',
                'neq',
                'in',
                'is',
                'or',
                'order',
                'limit',
              ]) {
                node[m] = jest.fn(self);
              }
              node.maybeSingle = jest.fn(async () => ({
                data: null,
                error: null,
              }));
              (node as { then?: unknown }).then = (
                resolve: (v: unknown) => unknown,
                reject?: (e: unknown) => unknown
              ) =>
                Promise.resolve({ data: [], error: null }).then(
                  resolve,
                  reject
                );
              return node;
            },
            insert: () => ({
              then: (
                resolve: (v: unknown) => unknown,
                reject?: (e: unknown) => unknown
              ) =>
                Promise.resolve({ data: null, error: null }).then(
                  resolve,
                  reject
                ),
            }),
            update: (patch: Record<string, unknown>) => {
              claimPatches.push(patch);
              return chain({ data: { id: 'att-1' }, error: null });
            },
            delete: () => {
              throw new Error('must not abandon after Wompi call');
            },
          };
        }
        if (table === 'billing_email_events') {
          return {
            insert: () =>
              chain({
                data: null,
                error: { code: '23505', message: 'duplicate' },
              }),
          };
        }
        return chain({ data: null, error: null });
      }),
      rpc: jest.fn(async (fn: string) => {
        if (fn === 'acquire_billing_charge_lease') {
          // Succeed until after Wompi returns, then fail post-charge refresh
          if (wompiCalled) return { data: false, error: null };
          return { data: true, error: null };
        }
        if (fn === 'release_billing_charge_lease') {
          return { data: true, error: null };
        }
        return { data: true, error: null };
      }),
    };

    const wompi = {
      createSourceTransaction: jest.fn(async () => {
        wompiCalled = true;
        return {
          id: 'tx-kept',
          status: 'PENDING',
          amountInCents: 990000,
        };
      }),
      getTransaction: jest.fn(),
      findTransactionByReference: jest.fn(),
      waitForTransactionStatus: jest.fn(),
    };

    const summary = await processWompiRenewals(supabase as never, wompi as never, {
      now,
      emailSender,
      timeBudgetMs: 30_000,
    });

    expect(wompi.createSourceTransaction).toHaveBeenCalled();
    expect(
      claimPatches.some(
        p =>
          p.wompi_transaction_id === 'tx-kept' ||
          p.error_message === 'LEASE_LOST_AFTER_CHARGE'
      )
    ).toBe(true);
    expect(
      summary.errors.some(e => e.message.includes('Lease lost after Wompi'))
    ).toBe(true);

    configureChargeLeaseForTests({ alwaysGrant: true });
  });
});

describe('round-9: requires_refund alerting', () => {
  const originalAlert = process.env.BILLING_ALERT_EMAIL;
  const originalResend = process.env.RESEND_API_KEY;

  afterEach(() => {
    if (originalAlert === undefined) delete process.env.BILLING_ALERT_EMAIL;
    else process.env.BILLING_ALERT_EMAIL = originalAlert;
    if (originalResend === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalResend;
    setAdminEmailSenderForTests(null);
    jest.restoreAllMocks();
  });

  it('parseBillingAlertEmails splits comma-separated list', () => {
    expect(parseBillingAlertEmails('a@x.com, b@y.com')).toEqual([
      'a@x.com',
      'b@y.com',
    ]);
    expect(parseBillingAlertEmails('')).toEqual([]);
    expect(parseBillingAlertEmails(null)).toEqual([]);
  });

  it('refundSummaryPeriodKey is UTC YYYYMMDD', () => {
    expect(refundSummaryPeriodKey(new Date('2026-11-18T23:30:00.000Z'))).toBe(
      'refund_summary_20261118'
    );
  });

  it('send failure via injected sender clears refund_alerted_at claim', async () => {
    process.env.BILLING_ALERT_EMAIL = 'ops@iablee.com';

    const sendMock = jest.fn(async () => ({
      sent: false as const,
      error: 'smtp down',
    }));
    setAdminEmailSenderForTests(sendMock);

    const updates: Record<string, unknown>[] = [];
    const attempt = {
      id: 'att-refund-1',
      user_id: userId,
      subscription_id: subId,
      wompi_reference: reference,
      wompi_transaction_id: 'tx-1',
      amount_cents: 990000,
      currency: 'COP',
      refund_reason: 'Period already extended',
      requires_refund: true as const,
      refund_alerted_at: null as string | null,
      refund_alert_sent_at: null as string | null,
    };

    const supabase = {
      from: jest.fn(() => ({
        update: (patch: Record<string, unknown>) => {
          updates.push(patch);
          const node: Record<string, unknown> = {};
          const self = () => node;
          node.eq = jest.fn(self);
          node.is = jest.fn(self);
          node.or = jest.fn(self);
          node.select = jest.fn(self);
          node.maybeSingle = jest.fn(async () => {
            if (typeof patch.refund_alerted_at === 'string') {
              return { data: { id: attempt.id }, error: null };
            }
            return { data: { id: attempt.id }, error: null };
          });
          return node;
        },
      })),
    };

    const result = await alertRequiresRefundOnce(supabase as never, attempt);
    expect(result.sent).toBe(false);
    expect(result.error).toBe('smtp down');
    expect(sendMock).toHaveBeenCalled();
    expect(updates.some(p => typeof p.refund_alerted_at === 'string')).toBe(
      true
    );
    expect(updates.some(p => p.refund_alerted_at === null)).toBe(true);
    expect(updates.some(p => p.refund_alert_sent_at)).toBe(false);

    // Fresh claim while sent_at set → skipped
    const skipped = await alertRequiresRefundOnce(supabase as never, {
      ...attempt,
      refund_alert_sent_at: '2026-11-18T00:00:00.000Z',
    });
    expect(skipped.skipped).toBe(true);
  });

  it('sets refund_alert_sent_at on successful send', async () => {
    process.env.BILLING_ALERT_EMAIL = 'ops@iablee.com';
    setAdminEmailSenderForTests(async () => ({ sent: true }));

    const updates: Record<string, unknown>[] = [];
    const supabase = {
      from: jest.fn(() => ({
        update: (patch: Record<string, unknown>) => {
          updates.push(patch);
          const node: Record<string, unknown> = {};
          const self = () => node;
          node.eq = jest.fn(self);
          node.is = jest.fn(self);
          node.or = jest.fn(self);
          node.select = jest.fn(self);
          node.maybeSingle = jest.fn(async () => ({
            data: { id: 'att-1' },
            error: null,
          }));
          return node;
        },
      })),
    };

    const result = await alertRequiresRefundOnce(supabase as never, {
      id: 'att-1',
      user_id: userId,
      subscription_id: subId,
      wompi_reference: reference,
      wompi_transaction_id: 'tx-1',
      amount_cents: 990000,
      currency: 'COP',
      refund_reason: 'test',
      requires_refund: true,
      refund_alerted_at: null,
      refund_alert_sent_at: null,
    });

    expect(result.sent).toBe(true);
    expect(updates.some(p => typeof p.refund_alert_sent_at === 'string')).toBe(
      true
    );
  });

  it('reclaims stale in-flight claim without sent_at', async () => {
    process.env.BILLING_ALERT_EMAIL = 'ops@iablee.com';
    setAdminEmailSenderForTests(async () => ({ sent: true }));

    const staleAt = new Date(
      Date.now() - REFUND_ALERT_CLAIM_STALE_MS - 1000
    ).toISOString();
    let orFilter: string | null = null;

    const supabase = {
      from: jest.fn(() => ({
        update: (patch: Record<string, unknown>) => {
          const node: Record<string, unknown> = {};
          const self = () => node;
          node.eq = jest.fn(self);
          node.is = jest.fn(self);
          node.or = jest.fn((expr: string) => {
            orFilter = expr;
            return node;
          });
          node.select = jest.fn(self);
          node.maybeSingle = jest.fn(async () => ({
            data: patch.refund_alert_sent_at
              ? { id: 'att-stale' }
              : { id: 'att-stale' },
            error: null,
          }));
          return node;
        },
      })),
    };

    const result = await alertRequiresRefundOnce(
      supabase as never,
      {
        id: 'att-stale',
        user_id: userId,
        subscription_id: subId,
        wompi_reference: reference,
        wompi_transaction_id: 'tx-1',
        amount_cents: 990000,
        currency: 'COP',
        refund_reason: 'stale claim',
        requires_refund: true,
        refund_alerted_at: staleAt,
        refund_alert_sent_at: null,
      },
      { now: new Date() }
    );

    expect(result.sent).toBe(true);
    expect(orFilter).toMatch(/refund_alerted_at\.is\.null/);
    expect(orFilter).toMatch(/refund_alerted_at\.lt\./);
  });

  it('leaves claim unset and logs CRITICAL when BILLING_ALERT_EMAIL unset', async () => {
    delete process.env.BILLING_ALERT_EMAIL;
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    let updateCalled = false;
    const supabase = {
      from: jest.fn(() => ({
        update: () => {
          updateCalled = true;
          return chain({ data: null, error: null });
        },
      })),
    };

    const result = await alertRequiresRefundOnce(supabase as never, {
      id: 'att-1',
      user_id: userId,
      subscription_id: subId,
      wompi_reference: reference,
      wompi_transaction_id: 'tx-1',
      amount_cents: 990000,
      currency: 'COP',
      refund_reason: 'test',
      requires_refund: true,
      refund_alerted_at: null,
      refund_alert_sent_at: null,
    });

    expect(result.sent).toBe(false);
    expect(result.error).toBe('BILLING_ALERT_EMAIL unset');
    expect(updateCalled).toBe(false);
    expect(
      errSpy.mock.calls.some(c =>
        String(c[0]).includes('BILLING_ALERT_EMAIL unset')
      )
    ).toBe(true);
    errSpy.mockRestore();
  });

  it('daily summary dedupes via billing_email_events and includes count + ids', async () => {
    process.env.BILLING_ALERT_EMAIL = 'ops@iablee.com';
    const sendMock = jest.fn(async () => ({ sent: true as const }));
    setAdminEmailSenderForTests(sendMock);

    const inserts: Record<string, unknown>[] = [];
    const unresolved = [
      { id: 'att-a', user_id: userId },
      { id: 'att-b', user_id: userId },
    ];

    let attemptListCalls = 0;
    const supabase = {
      from: jest.fn((table: string) => {
        if (table === 'billing_renewal_attempts') {
          return {
            select: () => {
              const node: Record<string, unknown> = {};
              const self = () => node;
              node.eq = jest.fn(self);
              node.is = jest.fn(self);
              node.or = jest.fn(self);
              node.order = jest.fn(self);
              node.limit = jest.fn(async () => {
                attemptListCalls++;
                if (attemptListCalls === 1) return { data: [], error: null };
                return { data: unresolved, error: null };
              });
              return node;
            },
          };
        }
        if (table === 'billing_email_events') {
          return {
            insert: (row: Record<string, unknown>) => {
              inserts.push(row);
              return {
                select: () => ({
                  maybeSingle: async () => ({
                    data: { id: 'evt-summary' },
                    error: null,
                  }),
                }),
              };
            },
            delete: () => ({
              eq: async () => ({ error: null }),
            }),
          };
        }
        return chain({ data: null, error: null });
      }),
    };

    const out = await processRequiresRefundAlerts(supabase as never, {
      now: new Date('2026-11-18T12:00:00.000Z'),
    });

    expect(out.unresolvedCount).toBe(2);
    expect(out.unresolvedIds).toEqual(['att-a', 'att-b']);
    expect(out.summaryEmailSent).toBe(true);
    expect(sendMock).toHaveBeenCalled();
    expect(inserts[0]?.email_type).toBe('refund_summary');
    expect(inserts[0]?.period_key).toBe('refund_summary_20261118');
    expect(
      (inserts[0]?.metadata as { attemptIds: string[] })?.attemptIds
    ).toEqual(['att-a', 'att-b']);

    // Same-day duplicate claim → no second send
    let attemptListCalls2 = 0;
    sendMock.mockClear();
    const supabaseDup = {
      from: jest.fn((table: string) => {
        if (table === 'billing_renewal_attempts') {
          return {
            select: () => {
              const node: Record<string, unknown> = {};
              const self = () => node;
              node.eq = jest.fn(self);
              node.is = jest.fn(self);
              node.or = jest.fn(self);
              node.order = jest.fn(self);
              node.limit = jest.fn(async () => {
                attemptListCalls2++;
                if (attemptListCalls2 === 1) return { data: [], error: null };
                return { data: unresolved, error: null };
              });
              return node;
            },
          };
        }
        if (table === 'billing_email_events') {
          return {
            insert: () => ({
              select: () => ({
                maybeSingle: async () => ({
                  data: null,
                  error: { code: '23505', message: 'duplicate key' },
                }),
              }),
            }),
          };
        }
        return chain({ data: null, error: null });
      }),
    };

    const out2 = await processRequiresRefundAlerts(supabaseDup as never, {
      now: new Date('2026-11-18T18:00:00.000Z'),
    });
    expect(out2.summaryEmailSent).toBe(false);
    expect(sendMock).not.toHaveBeenCalled();
    expect(out2.unresolvedCount).toBe(2);
  });

  it('does not send daily summary when claim insert fails with non-23505', async () => {
    process.env.BILLING_ALERT_EMAIL = 'ops@iablee.com';
    const sendMock = jest.fn(async () => ({ sent: true as const }));
    setAdminEmailSenderForTests(sendMock);
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const unresolved = [{ id: 'att-a', user_id: userId }];
    let attemptListCalls = 0;

    const supabase = {
      from: jest.fn((table: string) => {
        if (table === 'billing_renewal_attempts') {
          return {
            select: () => {
              const node: Record<string, unknown> = {};
              const self = () => node;
              node.eq = jest.fn(self);
              node.is = jest.fn(self);
              node.or = jest.fn(self);
              node.order = jest.fn(self);
              node.limit = jest.fn(async () => {
                attemptListCalls++;
                if (attemptListCalls === 1) return { data: [], error: null };
                return { data: unresolved, error: null };
              });
              return node;
            },
          };
        }
        if (table === 'billing_email_events') {
          return {
            insert: () => ({
              select: () => ({
                maybeSingle: async () => ({
                  data: null,
                  error: { code: '57014', message: 'statement timeout' },
                }),
              }),
            }),
          };
        }
        return chain({ data: null, error: null });
      }),
    };

    const out = await processRequiresRefundAlerts(supabase as never, {
      now: new Date('2026-11-18T12:00:00.000Z'),
    });

    expect(out.summaryEmailSent).toBe(false);
    expect(sendMock).not.toHaveBeenCalled();
    expect(
      errSpy.mock.calls.some(c =>
        String(c[0]).includes('refund_summary claim failed')
      )
    ).toBe(true);
    errSpy.mockRestore();
  });
});
