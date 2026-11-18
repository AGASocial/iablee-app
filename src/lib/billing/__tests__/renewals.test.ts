/**
 * @jest-environment node
 */
import { processWompiRenewals, applyWompiRenewalApproval } from '../renewals';
import { buildWompiRenewalReference } from '../wompi-references';

function createQueryBuilder(result: { data?: unknown; error?: unknown }) {
  const builder: Record<string, unknown> = {};
  const self = () => builder;
  for (const method of [
    'select',
    'eq',
    'neq',
    'in',
    'is',
    'lte',
    'gt',
    'order',
    'limit',
    'update',
    'insert',
    'upsert',
  ]) {
    builder[method] = jest.fn(self);
  }
  builder.maybeSingle = jest.fn(async () => result);
  builder.single = jest.fn(async () => result);
  builder.then = undefined;
  // Make thenable for await supabase.from().insert()
  (builder as { then?: unknown }).then = (
    resolve: (v: unknown) => unknown
  ) => Promise.resolve(result).then(resolve);
  return builder;
}

describe('processWompiRenewals selection', () => {
  const emailSender = {
    send: jest.fn(async () => ({ sent: true })),
  };

  const periodEnd = '2026-11-10T07:00:00.000Z';
  const now = new Date('2026-11-10T08:00:00.000Z');
  const subId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const userId = '11111111-2222-3333-4444-555555555555';

  it('skips cancel_at_period_end by canceling without charge', async () => {
    const updates: unknown[] = [];
    const supabase = {
      from: jest.fn((table: string) => {
        if (table === 'billing_subscriptions') {
          return {
            select: () => ({
              eq: () => ({
                in: () => ({
                  lte: () => ({
                    order: () => ({
                      limit: async () => ({
                        data: [
                          {
                            id: subId,
                            user_id: userId,
                            plan_id: 'plan_premium_month',
                            status: 'active',
                            cancel_at_period_end: true,
                            current_period_end: periodEnd,
                            current_period_start: '2026-10-10T07:00:00.000Z',
                            provider: 'wompi',
                          },
                        ],
                        error: null,
                      }),
                    }),
                  }),
                }),
              }),
            }),
            update: (payload: unknown) => {
              updates.push(payload);
              return {
                eq: () => ({
                  neq: async () => ({ error: null }),
                }),
              };
            },
          };
        }
        if (table === 'billing_email_events') {
          return createQueryBuilder({ data: null, error: null });
        }
        return createQueryBuilder({ data: [], error: null });
      }),
    };

    const wompi = {
      createSourceTransaction: jest.fn(),
      getTransaction: jest.fn(),
      waitForTransactionStatus: jest.fn(),
    };

    const summary = await processWompiRenewals(supabase as never, wompi as never, {
      now,
      emailSender,
    });

    expect(summary.canceledAtPeriodEnd).toBe(1);
    expect(wompi.createSourceTransaction).not.toHaveBeenCalled();
    expect(updates[0]).toMatchObject({ status: 'canceled' });
  });

  it('does not charge when a pending attempt exists (reconciles instead)', async () => {
    const reference = buildWompiRenewalReference(subId, periodEnd, 1);
    let insertCalled = false;

    const supabase = {
      from: jest.fn((table: string) => {
        if (table === 'billing_subscriptions') {
          return {
            select: () => ({
              eq: () => ({
                in: () => ({
                  lte: () => ({
                    order: () => ({
                      limit: async () => ({
                        data: [
                          {
                            id: subId,
                            user_id: userId,
                            plan_id: 'plan_premium_month',
                            status: 'active',
                            cancel_at_period_end: false,
                            current_period_end: periodEnd,
                            current_period_start: '2026-10-10T07:00:00.000Z',
                            provider: 'wompi',
                          },
                        ],
                        error: null,
                      }),
                    }),
                  }),
                }),
              }),
            }),
            update: () => ({
              eq: async () => ({ error: null }),
            }),
          };
        }
        if (table === 'billing_renewal_attempts') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  in: async () => ({
                    data: [
                      {
                        id: 'attempt-1',
                        subscription_id: subId,
                        user_id: userId,
                        period_end: periodEnd,
                        attempt_number: 1,
                        wompi_reference: reference,
                        wompi_transaction_id: 'tx-pending',
                        amount_cents: 990000,
                        status: 'pending',
                      },
                    ],
                    error: null,
                  }),
                  eq: () => ({
                    maybeSingle: async () => ({ data: null, error: null }),
                    order: () => ({
                      // prior attempts
                    }),
                  }),
                  order: () =>
                    Promise.resolve({
                      data: [{ attempt_number: 1, status: 'pending' }],
                      error: null,
                    }),
                }),
              }),
            }),
            insert: () => {
              insertCalled = true;
              return Promise.resolve({ error: null });
            },
            update: () => ({
              eq: async () => ({ error: null }),
            }),
          };
        }
        if (table === 'billing_plans') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    name: 'Premium',
                    interval: 'month',
                    provider_price_map: { wompi: '990000' },
                  },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'billing_invoices') {
          return {
            upsert: async () => ({ error: null }),
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            }),
            insert: async () => ({ error: null }),
            update: () => ({
              eq: async () => ({ error: null }),
            }),
          };
        }
        if (table === 'billing_email_events') {
          return {
            insert: async () => ({ error: null }),
          };
        }
        if (table === 'users') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { email: 'user@example.com' },
                  error: null,
                }),
              }),
            }),
          };
        }
        return createQueryBuilder({ data: null, error: null });
      }),
    };

    const wompi = {
      createSourceTransaction: jest.fn(),
      getTransaction: jest.fn(async () => ({
        id: 'tx-pending',
        status: 'PENDING',
        reference,
        amountInCents: 990000,
        currency: 'COP',
      })),
      waitForTransactionStatus: jest.fn(),
    };

    const summary = await processWompiRenewals(supabase as never, wompi as never, {
      now,
      emailSender,
      batchSize: 10,
    });

    expect(insertCalled).toBe(false);
    expect(wompi.createSourceTransaction).not.toHaveBeenCalled();
    expect(summary.reconciled).toBeGreaterThanOrEqual(1);
  });
});

describe('applyWompiRenewalApproval idempotency', () => {
  it('no-ops when attempt already approved', async () => {
    const supabase = {
      from: jest.fn((table: string) => {
        if (table === 'billing_renewal_attempts') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    status: 'approved',
                    subscription_id: 'sub',
                    period_end: '2026-11-10T07:00:00.000Z',
                  },
                  error: null,
                }),
              }),
            }),
          };
        }
        return createQueryBuilder({ data: null, error: null });
      }),
    };

    const ok = await applyWompiRenewalApproval(supabase as never, {
      reference: 'wompi_renew_sub_20261110_1',
      transactionId: 'tx',
      amountCents: 990000,
    });
    expect(ok).toBe(true);
  });
});
