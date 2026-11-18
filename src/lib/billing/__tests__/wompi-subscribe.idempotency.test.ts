/**
 * @jest-environment node
 */
import {
  createWompiSourceAndSubscribe,
  activateFirstCharge,
  findBlockingSubscription,
  cancelOrphanIncompleteSubscriptions,
} from '../wompi-subscribe';
import { FIRST_CHARGE_PERIOD_SENTINEL } from '../wompi-references';
import { PaymentGatewayError } from '../types';

const userId = '48508890-08ea-40bc-8dc6-4a0860f6bc6a';
const planId = 'plan_premium_month';
const subId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

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
  providerPriceMap: { wompi: '990000' },
};

const incompleteRow = {
  id: subId,
  status: 'incomplete',
  current_period_end: null,
  plan_id: planId,
};

function chain(terminal: { data?: unknown; error?: unknown }) {
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
    'lt',
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

describe('createWompiSourceAndSubscribe first-charge idempotency', () => {
  it('refuses when user already has active Wompi sub with future period', async () => {
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
                            id: subId,
                            status: 'active',
                            current_period_end: new Date(
                              Date.now() + 86400000
                            ).toISOString(),
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
          };
        }
        return {};
      }),
    };

    const wompi = {
      createPaymentSource: jest.fn(),
      createSourceTransaction: jest.fn(),
    };

    const result = await createWompiSourceAndSubscribe(
      supabase as never,
      wompi as never,
      {
        userId,
        plan,
        email: 'a@b.com',
        paymentType: 'CARD',
        paymentToken: 'tok_test',
        acceptanceToken: 'acc',
        acceptPersonalAuth: 'pers',
      }
    );

    expect(result.alreadyActive).toBe(true);
    expect(result.status).toBe('active');
    expect(wompi.createPaymentSource).not.toHaveBeenCalled();
    expect(wompi.createSourceTransaction).not.toHaveBeenCalled();
  });

  it('does not double-charge when first-charge attempt is already in-flight', async () => {
    const reference = `wompi_first_${userId}_${planId}_${subId}_1`;
    let insertAttempts = 0;

    let subSelect = 0;
    const supabase = {
      from: jest.fn((table: string) => {
        if (table === 'billing_subscriptions') {
          return {
            select: () => {
              subSelect++;
              if (subSelect === 1) {
                return chain({ data: [], error: null });
              }
              return chain({
                data: [incompleteRow],
                error: null,
              });
            },
            update: () => chain({ data: null, error: null }),
            insert: () =>
              chain({
                data: incompleteRow,
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
                    status: 'pending',
                    attempt_number: 1,
                    wompi_transaction_id: 'tx-inflight',
                    wompi_reference: reference,
                    claimed_at: new Date().toISOString(),
                  },
                ],
                error: null,
              }),
            insert: () => {
              insertAttempts++;
              return Promise.resolve({ error: null });
            },
            update: () => chain({ data: { id: 'a' }, error: null }),
          };
        }
        return chain({ data: null, error: null });
      }),
    };

    const wompi = {
      createPaymentSource: jest.fn(),
      createSourceTransaction: jest.fn(),
      getTransaction: jest.fn(async () => ({
        id: 'tx-inflight',
        status: 'PENDING',
        reference,
        amountInCents: 990000,
        currency: 'COP',
      })),
      findTransactionByReference: jest.fn(),
      waitForTransactionStatus: jest.fn(),
    };

    const result = await createWompiSourceAndSubscribe(
      supabase as never,
      wompi as never,
      {
        userId,
        plan,
        email: 'a@b.com',
        paymentType: 'CARD',
        paymentToken: 'tok_test',
        acceptanceToken: 'acc',
        acceptPersonalAuth: 'pers',
      }
    );

    expect(result.transactionStatus).toBe('PENDING');
    expect(insertAttempts).toBe(0);
    expect(wompi.createSourceTransaction).not.toHaveBeenCalled();
    expect(FIRST_CHARGE_PERIOD_SENTINEL).toBe('1970-01-01T00:00:00.000Z');
  });

  it('DECLINED first charge → retry uses fresh reference with attempt counter', async () => {
    const declinedRef = `wompi_first_${userId}_${planId}_${subId}_1`;
    const retryRef = `wompi_first_${userId}_${planId}_${subId}_2`;
    let claimedAttemptNumber: number | null = null;
    let claimedReference: string | null = null;

    let subSelect = 0;
    const supabase = {
      from: jest.fn((table: string) => {
        if (table === 'billing_subscriptions') {
          return {
            select: () => {
              subSelect++;
              if (subSelect === 1) {
                return chain({ data: [], error: null });
              }
              return chain({
                data: [incompleteRow],
                error: null,
              });
            },
            update: () => chain({ data: { id: subId }, error: null }),
            insert: () =>
              chain({
                data: incompleteRow,
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
                    status: 'declined',
                    attempt_number: 1,
                    wompi_transaction_id: 'tx-declined',
                    wompi_reference: declinedRef,
                    claimed_at: new Date().toISOString(),
                  },
                ],
                error: null,
              }),
            insert: (row: Record<string, unknown>) => {
              claimedAttemptNumber = row.attempt_number as number;
              claimedReference = row.wompi_reference as string;
              return Promise.resolve({ error: null });
            },
            update: () => chain({ data: { id: 'a' }, error: null }),
          };
        }
        if (table === 'billing_payment_methods') {
          return {
            update: () => chain({ data: null, error: null }),
            insert: () =>
              chain({ data: { id: 'pm-1' }, error: null }),
          };
        }
        if (table === 'billing_invoices') {
          return {
            insert: async () => ({ error: null }),
            update: () => chain({ data: null, error: null }),
            select: () => chain({ data: null, error: null }),
            upsert: async () => ({ error: null }),
          };
        }
        if (table === 'billing_email_events') {
          return {
            insert: () =>
              chain({ data: { id: 'e' }, error: null }),
            delete: () => chain({ data: null, error: null }),
          };
        }
        return chain({ data: null, error: null });
      }),
    };

    const wompi = {
      createPaymentSource: jest.fn(async () => ({
        id: 99,
        status: 'AVAILABLE',
        type: 'CARD',
        publicData: { last_four: '4242' },
      })),
      createSourceTransaction: jest.fn(async () => ({
        id: 'tx-retry',
        status: 'APPROVED',
        reference: retryRef,
        amountInCents: 990000,
        currency: 'COP',
      })),
      getTransaction: jest.fn(),
      findTransactionByReference: jest.fn(),
      waitForTransactionStatus: jest.fn(async () => ({
        id: 'tx-retry',
        status: 'APPROVED',
        reference: retryRef,
        amountInCents: 990000,
        currency: 'COP',
      })),
    };

    const result = await createWompiSourceAndSubscribe(
      supabase as never,
      wompi as never,
      {
        userId,
        plan,
        email: 'a@b.com',
        paymentType: 'CARD',
        paymentToken: 'tok_test',
        acceptanceToken: 'acc',
        acceptPersonalAuth: 'pers',
        emailSender: { send: jest.fn(async () => ({ sent: true })) },
      }
    );

    expect(claimedAttemptNumber).toBe(2);
    expect(claimedReference).toBe(retryRef);
    expect(wompi.createSourceTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ reference: retryRef })
    );
    expect(result.transactionStatus).toBe('APPROVED');
  });

  it('surfaces claim failure after DECLINED as error, not fake PENDING', async () => {
    const declinedRef = `wompi_first_${userId}_${planId}_${subId}_1`;

    const chain = (terminal: { data?: unknown; error?: unknown }) => {
      const api: Record<string, unknown> = {};
      const self = () => api;
      for (const m of ['select', 'eq', 'in', 'order', 'limit', 'update', 'insert', 'is', 'neq']) {
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

    let subSelect = 0;
    const supabase = {
      from: jest.fn((table: string) => {
        if (table === 'billing_subscriptions') {
          return {
            select: () => {
              subSelect++;
              if (subSelect === 1) {
                return chain({ data: [], error: null });
              }
              return chain({
                data: [incompleteRow],
                error: null,
              });
            },
            update: () => chain({ data: null, error: null }),
            insert: () =>
              chain({
                data: incompleteRow,
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
                    status: 'declined',
                    attempt_number: 1,
                    wompi_transaction_id: 'tx-declined',
                    wompi_reference: declinedRef,
                  },
                ],
                error: null,
              }),
            insert: async () => ({ error: { code: '23505', message: 'unique' } }),
          };
        }
        return chain({ data: null, error: null });
      }),
    };

    const wompi = {
      createPaymentSource: jest.fn(),
      createSourceTransaction: jest.fn(),
    };

    await expect(
      createWompiSourceAndSubscribe(supabase as never, wompi as never, {
        userId,
        plan,
        email: 'a@b.com',
        paymentType: 'CARD',
        paymentToken: 'tok_test',
        acceptanceToken: 'acc',
        acceptPersonalAuth: 'pers',
      })
    ).rejects.toMatchObject({ code: 'FIRST_CHARGE_RETRY_CLAIM_FAILED' });
    expect(wompi.createSourceTransaction).not.toHaveBeenCalled();
  });

  it('keeps stale claim open when reference lookup is inconclusive', async () => {
    const reference = `wompi_first_${userId}_${planId}_${subId}_1`;
    const stale = new Date(Date.now() - 20 * 60 * 1000).toISOString();

    let subSelect = 0;
    const supabase = {
      from: jest.fn((table: string) => {
        if (table === 'billing_subscriptions') {
          return {
            select: () => {
              subSelect++;
              if (subSelect === 1) {
                return chain({ data: [], error: null });
              }
              return chain({
                data: [incompleteRow],
                error: null,
              });
            },
            update: () => chain({ data: null, error: null }),
            insert: () =>
              chain({
                data: incompleteRow,
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
                    status: 'claimed',
                    attempt_number: 1,
                    wompi_transaction_id: null,
                    wompi_reference: reference,
                    claimed_at: stale,
                  },
                ],
                error: null,
              }),
            insert: jest.fn(async () => {
              throw new Error('must not open new claim');
            }),
            update: () => chain({ data: { id: 'a' }, error: null }),
          };
        }
        return chain({ data: null, error: null });
      }),
    };

    const wompi = {
      createPaymentSource: jest.fn(),
      createSourceTransaction: jest.fn(),
      findTransactionByReference: jest.fn(async () => ({
        kind: 'error' as const,
        httpStatus: 500,
        message: 'HTTP 500',
      })),
    };

    const result = await createWompiSourceAndSubscribe(
      supabase as never,
      wompi as never,
      {
        userId,
        plan,
        email: 'a@b.com',
        paymentType: 'CARD',
        paymentToken: 'tok_test',
        acceptanceToken: 'acc',
        acceptPersonalAuth: 'pers',
      }
    );

    expect(result.transactionStatus).toBe('PENDING');
    expect(wompi.createSourceTransaction).not.toHaveBeenCalled();
  });
});

describe('activateFirstCharge idempotency', () => {
  it('does not recompute period when already active with future end', async () => {
    const future = new Date(Date.now() + 7 * 86400000).toISOString();
    const subUpdates: unknown[] = [];

    const supabase = {
      from: jest.fn((table: string) => {
        if (table === 'billing_subscriptions') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: subId,
                    status: 'active',
                    current_period_end: future,
                    billing_anchor_day: 10,
                  },
                  error: null,
                }),
              }),
            }),
            update: (payload: unknown) => {
              subUpdates.push(payload);
              return {
                eq: () => ({
                  in: () => ({
                    select: () => ({
                      maybeSingle: async () => ({ data: null, error: null }),
                    }),
                  }),
                  lt: async () => ({ error: null }),
                }),
              };
            },
          };
        }
        if (table === 'billing_renewal_attempts') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { status: 'approved', requires_refund: null },
                  error: null,
                }),
              }),
            }),
            update: () => ({
              eq: () => ({
                in: () => ({
                  select: () => ({
                    maybeSingle: async () => ({ data: { id: 'a' }, error: null }),
                  }),
                }),
              }),
            }),
          };
        }
        if (table === 'billing_invoices') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: { id: 'inv' }, error: null }),
              }),
            }),
            update: () => ({ eq: async () => ({ error: null }) }),
          };
        }
        if (table === 'billing_email_events') {
          return {
            insert: () => ({
              select: () => ({
                maybeSingle: async () => ({
                  data: null,
                  error: { code: '23505', message: 'dup' },
                }),
              }),
            }),
          };
        }
        return {};
      }),
    };

    const result = await activateFirstCharge(supabase as never, {
      userId,
      subscriptionId: subId,
      plan,
      reference: `wompi_first_${userId}_${planId}_${subId}`,
      transactionId: 'tx-real',
      amountInCents: 990000,
      email: 'a@b.com',
    });

    expect(result.activated).toBe(false);
    // Should not rewrite period boundaries on the already-active path
    expect(
      subUpdates.some(
        u =>
          u &&
          typeof u === 'object' &&
          'current_period_end' in (u as object)
      )
    ).toBe(false);
  });

  it('no-ops when CAS fails and attempt is already declined', async () => {
    const subUpdates: unknown[] = [];
    const supabase = {
      from: jest.fn((table: string) => {
        if (table === 'billing_subscriptions') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: subId,
                    status: 'incomplete',
                    current_period_end: null,
                    billing_anchor_day: null,
                  },
                  error: null,
                }),
              }),
            }),
            update: (payload: unknown) => {
              subUpdates.push(payload);
              return {
                eq: () => ({
                  in: () => ({
                    select: () => ({
                      maybeSingle: async () => ({ data: null, error: null }),
                    }),
                  }),
                  lt: () => ({
                    select: () => ({
                      maybeSingle: async () => ({ data: null, error: null }),
                    }),
                  }),
                }),
              };
            },
          };
        }
        if (table === 'billing_renewal_attempts') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { status: 'declined', requires_refund: null },
                  error: null,
                }),
              }),
            }),
            update: () => ({
              eq: () => ({
                in: () => ({
                  select: () => ({
                    maybeSingle: async () => ({ data: null, error: null }),
                  }),
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

    const result = await activateFirstCharge(supabase as never, {
      userId,
      subscriptionId: subId,
      plan,
      reference: `wompi_first_${userId}_${planId}_${subId}_1`,
      transactionId: 'tx',
      amountInCents: 990000,
      email: 'a@b.com',
    });

    expect(result.activated).toBe(false);
    expect(subUpdates).toHaveLength(0);
  });
});

describe('findBlockingSubscription', () => {
  it('blocks past_due even when current_period_end is in the past', async () => {
    const past = new Date(Date.now() - 3 * 86400000).toISOString();
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              in: () => ({
                order: () => ({
                  limit: async () => ({
                    data: [
                      {
                        id: subId,
                        status: 'past_due',
                        current_period_end: past,
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
      }),
    };

    const blocked = await findBlockingSubscription(supabase as never, userId);
    expect(blocked?.id).toBe(subId);
    expect(blocked?.status).toBe('past_due');
  });

  it('blocks active within entitlement grace after period end', async () => {
    const justEnded = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              in: () => ({
                order: () => ({
                  limit: async () => ({
                    data: [
                      {
                        id: subId,
                        status: 'active',
                        current_period_end: justEnded,
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
      }),
    };

    const blocked = await findBlockingSubscription(supabase as never, userId);
    expect(blocked?.id).toBe(subId);
  });

  it('tombstones expired active past grace with no open attempt, then allows subscribe', async () => {
    const expired = new Date(Date.now() - 3 * 86400000).toISOString();
    let tombstonePayload: Record<string, unknown> | null = null;
    let tableCalls = 0;

    const supabase = {
      from: jest.fn((table: string) => {
        if (table === 'billing_subscriptions') {
          tableCalls++;
          if (tableCalls === 1) {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    in: () => ({
                      order: () => ({
                        limit: async () => ({
                          data: [
                            {
                              id: subId,
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
            };
          }
          return {
            update: (payload: Record<string, unknown>) => {
              tombstonePayload = payload;
              return {
                eq: () => ({
                  eq: () => ({
                    eq: () => ({
                      select: () => ({
                        maybeSingle: async () => ({
                          data: { id: subId },
                          error: null,
                        }),
                      }),
                    }),
                  }),
                }),
              };
            },
          };
        }
        if (table === 'billing_renewal_attempts') {
          return {
            select: () => ({
              eq: () => ({
                in: () => ({
                  limit: async () => ({ data: [], error: null }),
                }),
              }),
            }),
          };
        }
        return {};
      }),
    };

    const blocked = await findBlockingSubscription(supabase as never, userId);
    expect(blocked).toBeNull();
    expect(tombstonePayload).toEqual(
      expect.objectContaining({
        status: 'canceled',
        canceled_reason: 'expired_resubscribe',
        cancel_at_period_end: true,
      })
    );
  });

  it('does not tombstone when a non-refund approved attempt exists for the period', async () => {
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
                            id: subId,
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
                        id: 'a-approved',
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
    expect(blocked?.id).toBe(subId);
  });

  it('blocks expired active when an open claimed/pending renewal exists', async () => {
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
                            id: subId,
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
              throw new Error('must not tombstone while attempt open');
            },
          };
        }
        if (table === 'billing_renewal_attempts') {
          return {
            select: () => ({
              eq: () => ({
                in: () => ({
                  limit: async () => ({
                    data: [{ id: 'open-attempt', status: 'claimed' }],
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
    expect(blocked?.id).toBe(subId);
  });
});

describe('cancelOrphanIncompleteSubscriptions', () => {
  it('cancels other incomplete Wompi subs for the user, keeping the target', async () => {
    const updates: Array<{ payload: Record<string, unknown>; filters: string[] }> = [];
    const filters: string[] = [];
    const supabase = {
      from: () => ({
        update: (payload: Record<string, unknown>) => {
          const recorded = { payload, filters: [] as string[] };
          updates.push(recorded);
          const api: Record<string, unknown> = {};
          const self = () => api;
          api.eq = jest.fn((col: string, val: string) => {
            recorded.filters.push(`${col}=${val}`);
            filters.push(`${col}=${val}`);
            return self();
          });
          api.neq = jest.fn((col: string, val: string) => {
            recorded.filters.push(`${col}!=${val}`);
            filters.push(`${col}!=${val}`);
            return Promise.resolve({ error: null });
          });
          return api;
        },
      }),
    };

    await cancelOrphanIncompleteSubscriptions(supabase as never, userId, subId);

    expect(updates).toHaveLength(1);
    expect(updates[0].payload.status).toBe('canceled');
    expect(updates[0].payload.canceled_reason).toBe('superseded');
    expect(filters).toEqual(
      expect.arrayContaining([
        `user_id=${userId}`,
        'provider=wompi',
        'status=incomplete',
        `id!=${subId}`,
      ])
    );
  });
});

describe('createSourceTransaction inconclusive keeps claimed', () => {
  it('records error_message but leaves status claimed on network/5xx', async () => {
    const attemptPatches: Record<string, unknown>[] = [];

    let subSelect = 0;
    const supabase = {
      from: jest.fn((table: string) => {
        if (table === 'billing_subscriptions') {
          return {
            select: () => {
              subSelect++;
              if (subSelect === 1) return chain({ data: [], error: null });
              return chain({
                data: [incompleteRow],
                error: null,
              });
            },
            update: () => chain({ data: null, error: null }),
            insert: () =>
              chain({
                data: incompleteRow,
                error: null,
              }),
          };
        }
        if (table === 'billing_renewal_attempts') {
          return {
            select: () => chain({ data: [], error: null }),
            insert: async () => ({ error: null }),
            update: (patch: Record<string, unknown>) => {
              attemptPatches.push(patch);
              return chain({ data: { id: 'a' }, error: null });
            },
          };
        }
        if (table === 'billing_payment_methods') {
          return {
            update: () => chain({ data: null, error: null }),
            insert: () => chain({ data: { id: 'pm' }, error: null }),
          };
        }
        if (table === 'billing_invoices') {
          return { insert: async () => ({ error: null }) };
        }
        return chain({ data: null, error: null });
      }),
    };

    const wompi = {
      createPaymentSource: jest.fn(async () => ({
        id: 1,
        status: 'AVAILABLE',
        type: 'CARD',
        publicData: {},
      })),
      createSourceTransaction: jest.fn(async () => {
        throw new PaymentGatewayError(
          'Wompi source transaction failed (503)',
          'wompi',
          'WOMPI_SOURCE_CHARGE_FAILED',
          503
        );
      }),
    };

    await expect(
      createWompiSourceAndSubscribe(supabase as never, wompi as never, {
        userId,
        plan,
        email: 'a@b.com',
        paymentType: 'CARD',
        paymentToken: 'tok',
        acceptanceToken: 'acc',
        acceptPersonalAuth: 'pers',
      })
    ).rejects.toBeInstanceOf(PaymentGatewayError);

    expect(attemptPatches.some(p => p.status === 'error')).toBe(false);
    expect(attemptPatches.some(p => typeof p.error_message === 'string')).toBe(
      true
    );
  });
});
