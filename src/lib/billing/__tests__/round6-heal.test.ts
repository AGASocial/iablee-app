/**
 * @jest-environment node
 *
 * Round-6: approved-first-charge heal, lease fail-closed, past_due status,
 * webhook soft-fail must not ack.
 */
import {
  activateFirstCharge,
  createWompiSourceAndSubscribe,
  findBlockingSubscription,
  reconcileApprovedFirstCharges,
} from '../wompi-subscribe';
import {
  configureChargeLeaseForTests,
  acquireChargeLease,
} from '../charge-leases';
import { applyWompiRenewalApproval } from '../renewals';
import { BillingError } from '../types';
import { FIRST_CHARGE_PERIOD_SENTINEL } from '../wompi-references';
import { BillingService } from '../billing.service';

const userId = '48508890-08ea-40bc-8dc6-4a0860f6bc6a';
const planId = 'plan_premium_month';
const subId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const reference = `wompi_first_${userId}_${planId}_${subId}_1`;

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

describe('round-6: heal approved first-charge while sub incomplete', () => {
  afterEach(() => {
    configureChargeLeaseForTests({ alwaysGrant: true });
  });

  it('activateFirstCharge promotes incomplete after attempt already approved', async () => {
    let subStatus = 'incomplete';
    const subUpdates: Record<string, unknown>[] = [];

    const supabase = {
      from: jest.fn((table: string) => {
        if (table === 'billing_subscriptions') {
          return {
            select: () => {
              const node = chain({
                data: {
                  id: subId,
                  status: subStatus,
                  current_period_end: null,
                  billing_anchor_day: null,
                  plan_id: planId,
                },
                error: null,
              });
              // peers check returns empty list
              (node as { then?: unknown }).then = (
                resolve: (v: unknown) => unknown,
                reject?: (e: unknown) => unknown
              ) =>
                Promise.resolve({ data: [], error: null }).then(resolve, reject);
              node.maybeSingle = jest.fn(async () => ({
                data: {
                  id: subId,
                  status: subStatus,
                  current_period_end:
                    subStatus === 'active'
                      ? new Date(Date.now() + 86400000).toISOString()
                      : null,
                  billing_anchor_day: 10,
                  plan_id: planId,
                },
                error: null,
              }));
              return node;
            },
            update: (payload: Record<string, unknown>) => {
              subUpdates.push(payload);
              if (payload.status === 'active') subStatus = 'active';
              return chain({ data: { id: subId }, error: null });
            },
          };
        }
        if (table === 'billing_renewal_attempts') {
          return {
            select: () =>
              chain({
                data: {
                  status: 'approved',
                  requires_refund: null,
                },
                error: null,
              }),
            update: () => chain({ data: { id: 'a' }, error: null }),
          };
        }
        if (table === 'billing_invoices') {
          return {
            select: () => chain({ data: null, error: null }),
            insert: async () => ({ error: null }),
            update: () => chain({ data: null, error: null }),
          };
        }
        if (table === 'billing_email_events') {
          return {
            insert: () =>
              chain({ data: { id: 'e' }, error: null }),
            delete: () => ({ eq: async () => ({ error: null }) }),
          };
        }
        return chain({ data: null, error: null });
      }),
    };

    const result = await activateFirstCharge(supabase as never, {
      userId,
      subscriptionId: subId,
      plan,
      reference,
      transactionId: 'tx-1',
      amountInCents: 490000,
      email: 'a@b.com',
    });

    expect(result.activated).toBe(true);
    expect(subUpdates.some(u => u.status === 'active')).toBe(true);
  });

  it('subscribe retry heals approved attempt and only returns active when sub is active', async () => {
    let subStatus = 'incomplete';
    let subSelect = 0;

    const supabase = {
      from: jest.fn((table: string) => {
        if (table === 'billing_subscriptions') {
          return {
            select: () => {
              subSelect++;
              // findBlocking → empty; incompletes → row; live after heal
              if (subSelect === 1) return chain({ data: [], error: null });
              if (subSelect === 2) {
                return chain({
                  data: [
                    {
                      id: subId,
                      status: 'incomplete',
                      current_period_end: null,
                      plan_id: planId,
                    },
                  ],
                  error: null,
                });
              }
              return chain({
                data: {
                  id: subId,
                  status: subStatus,
                  current_period_end:
                    subStatus === 'active'
                      ? new Date(Date.now() + 86400000).toISOString()
                      : null,
                },
                error: null,
              });
            },
            update: (payload: Record<string, unknown>) => {
              if (payload.status === 'active') subStatus = 'active';
              return chain({ data: { id: subId }, error: null });
            },
            insert: () =>
              chain({
                data: {
                  id: subId,
                  status: 'incomplete',
                  plan_id: planId,
                },
                error: null,
              }),
          };
        }
        if (table === 'billing_renewal_attempts') {
          return {
            select: () =>
              chain({
                data: [
                  {
                    status: 'approved',
                    attempt_number: 1,
                    wompi_reference: reference,
                    wompi_transaction_id: 'tx-1',
                    requires_refund: null,
                  },
                ],
                error: null,
              }),
            update: () => chain({ data: { id: 'a' }, error: null }),
          };
        }
        if (table === 'billing_invoices') {
          return {
            select: () => chain({ data: null, error: null }),
            insert: async () => ({ error: null }),
            update: () => chain({ data: null, error: null }),
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

    const result = await createWompiSourceAndSubscribe(
      supabase as never,
      {
        createPaymentSource: jest.fn(),
        createSourceTransaction: jest.fn(),
      } as never,
      {
        userId,
        plan,
        email: 'a@b.com',
        paymentType: 'CARD',
        paymentToken: 'tok',
        acceptanceToken: 'acc',
        acceptPersonalAuth: 'pers',
      }
    );

    expect(result.status).toBe('active');
    expect(result.alreadyActive).toBe(true);
    expect(result.transactionStatus).toBe('APPROVED');
  });

  it('reconcileApprovedFirstCharges promotes stuck incomplete', async () => {
    let promoted = false;
    const supabase = {
      from: jest.fn((table: string) => {
        if (table === 'billing_renewal_attempts') {
          return {
            select: () =>
              chain({
                data: [
                  {
                    wompi_reference: reference,
                    wompi_transaction_id: 'tx-1',
                    subscription_id: subId,
                    user_id: userId,
                    amount_cents: 490000,
                    requires_refund: null,
                  },
                ],
                error: null,
              }),
            update: () => chain({ data: { id: 'a' }, error: null }),
          };
        }
        if (table === 'billing_subscriptions') {
          return {
            select: () =>
              chain({
                data: {
                  id: subId,
                  status: promoted ? 'active' : 'incomplete',
                  plan_id: planId,
                  current_period_end: promoted
                    ? new Date(Date.now() + 86400000).toISOString()
                    : null,
                  billing_anchor_day: 10,
                },
                error: null,
              }),
            update: (payload: Record<string, unknown>) => {
              if (payload.status === 'active') promoted = true;
              return chain({ data: { id: subId }, error: null });
            },
          };
        }
        if (table === 'billing_plans') {
          return {
            select: () =>
              chain({
                data: {
                  id: planId,
                  name: 'Premium',
                  currency: 'USD',
                  amount_cents: 999,
                  interval: 'month',
                  features: plan.features,
                  provider_price_map: { wompi: '490000' },
                },
                error: null,
              }),
          };
        }
        if (table === 'users') {
          return {
            select: () =>
              chain({ data: { email: 'a@b.com' }, error: null }),
          };
        }
        if (table === 'billing_invoices') {
          return {
            select: () => chain({ data: null, error: null }),
            insert: async () => ({ error: null }),
            update: () => chain({ data: null, error: null }),
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

    // peers thenable empty
    const origFrom = supabase.from;
    supabase.from = jest.fn((table: string) => {
      const base = origFrom(table) as {
        select: () => Record<string, unknown>;
        update?: (p: Record<string, unknown>) => unknown;
      };
      if (table === 'billing_subscriptions') {
        return {
          select: () => {
            const node = base.select();
            (node as { then?: unknown }).then = (
              resolve: (v: unknown) => unknown,
              reject?: (e: unknown) => unknown
            ) =>
              Promise.resolve({ data: [], error: null }).then(resolve, reject);
            return node;
          },
          update: base.update,
        };
      }
      return base;
    });

    const summary = await reconcileApprovedFirstCharges(supabase as never, {
      limit: 10,
    });
    expect(summary.healed).toBeGreaterThanOrEqual(1);
    expect(promoted).toBe(true);
    expect(FIRST_CHARGE_PERIOD_SENTINEL).toBeTruthy();
  });
});

describe('round-6: past_due blocking status', () => {
  it('subscribe returns past_due + REQUIRES_PAYMENT_METHOD, not APPROVED/alreadyActive', async () => {
    const supabase = {
      from: jest.fn((table: string) => {
        if (table === 'billing_subscriptions') {
          return {
            select: () =>
              chain({
                data: [
                  {
                    id: subId,
                    status: 'past_due',
                    current_period_end: new Date(
                      Date.now() - 86400000
                    ).toISOString(),
                    plan_id: planId,
                  },
                ],
                error: null,
              }),
          };
        }
        return chain({ data: null, error: null });
      }),
    };

    const result = await createWompiSourceAndSubscribe(
      supabase as never,
      {
        createPaymentSource: jest.fn(),
        createSourceTransaction: jest.fn(),
      } as never,
      {
        userId,
        plan,
        email: 'a@b.com',
        paymentType: 'CARD',
        paymentToken: 'tok',
        acceptanceToken: 'acc',
        acceptPersonalAuth: 'pers',
      }
    );

    expect(result.status).toBe('past_due');
    expect(result.transactionStatus).toBe('REQUIRES_PAYMENT_METHOD');
    expect(result.alreadyActive).toBe(false);
    expect(result.message).toMatch(/past due/i);
  });
});

describe('round-6: lease fail-closed + webhook soft-fail', () => {
  afterEach(() => {
    configureChargeLeaseForTests({ alwaysGrant: true });
  });

  it('activateFirstCharge throws WOMPI_LEASE_CONTENTION when lease denied', async () => {
    configureChargeLeaseForTests({});
    const supabase = {
      rpc: jest.fn(async () => ({ data: false, error: null })),
      from: jest.fn(),
    };

    await expect(
      activateFirstCharge(supabase as never, {
        userId,
        subscriptionId: subId,
        plan,
        reference,
        transactionId: 'tx-1',
        amountInCents: 490000,
        email: 'a@b.com',
      })
    ).rejects.toMatchObject({ code: 'WOMPI_LEASE_CONTENTION' });
  });

  it('applyWompiRenewalApproval throws on lease contention so webhook can 5xx', async () => {
    configureChargeLeaseForTests({});
    const supabase = {
      rpc: jest.fn(async () => ({ data: false, error: null })),
      from: jest.fn((table: string) => {
        if (table === 'billing_renewal_attempts') {
          return {
            select: () =>
              chain({
                data: {
                  status: 'pending',
                  user_id: userId,
                  subscription_id: subId,
                  period_end: '2026-11-10T07:00:00.000Z',
                  amount_cents: 490000,
                  wompi_reference: 'wompi_renew_x_20261110_1',
                },
                error: null,
              }),
          };
        }
        return chain({ data: null, error: null });
      }),
    };

    await expect(
      applyWompiRenewalApproval(supabase as never, {
        reference: 'wompi_renew_x_20261110_1',
        transactionId: 'tx',
        amountCents: 490000,
      })
    ).rejects.toMatchObject({ code: 'WOMPI_LEASE_CONTENTION' });
  });

  it('BillingService leaves webhook unhandled when activation throws', async () => {
    configureChargeLeaseForTests({});
    let handledUpdate: Record<string, unknown> | null = null;

    const supabase = {
      rpc: jest.fn(async () => ({ data: false, error: null })),
      from: jest.fn((table: string) => {
        if (table === 'billing_webhook_events') {
          return {
            insert: () => ({
              select: () => ({
                single: async () => ({
                  data: { id: 'evt-1' },
                  error: null,
                }),
              }),
            }),
            update: (payload: Record<string, unknown>) => {
              handledUpdate = payload;
              return { eq: async () => ({ error: null }) };
            },
          };
        }
        if (table === 'billing_subscriptions') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: subId,
                      status: 'incomplete',
                      current_period_end: null,
                    },
                    error: null,
                  }),
                }),
                order: () => ({
                  limit: () => ({
                    maybeSingle: async () => ({
                      data: {
                        id: subId,
                        status: 'incomplete',
                        current_period_end: null,
                      },
                      error: null,
                    }),
                  }),
                }),
                maybeSingle: async () => ({
                  data: {
                    id: subId,
                    status: 'incomplete',
                    current_period_end: null,
                  },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'billing_plans') {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: {
                    id: planId,
                    name: 'Premium',
                    currency: 'USD',
                    amount_cents: 999,
                    interval: 'month',
                    features: plan.features,
                    provider_price_map: { wompi: '490000' },
                    is_active: true,
                    is_visible: true,
                  },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'users') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { email: 'a@b.com' },
                  error: null,
                }),
              }),
            }),
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
      getName: () => 'wompi',
    } as never);

    await expect(
      service.handleWebhookEvent({
        id: 'wompi-evt-1',
        provider: 'wompi',
        type: 'invoice.paid',
        data: {
          invoiceId: reference,
          amountCents: 490000,
          currency: 'COP',
          userId,
          planId,
          providerTransactionId: 'tx-1',
          customerId: 'c1',
          subscriptionId: subId,
        },
        raw: {},
      } as never)
    ).rejects.toBeInstanceOf(BillingError);

    expect(handledUpdate).toBeNull();
    expect(acquireChargeLease).toBeDefined();
    expect(findBlockingSubscription).toBeDefined();
  });
});
