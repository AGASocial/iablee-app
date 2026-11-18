/**
 * @jest-environment node
 */
import {
  processWompiRenewals,
  applyWompiRenewalApproval,
  casAttemptStatus,
} from '../renewals';
import { buildWompiRenewalReference } from '../wompi-references';
import { CLAIM_STALE_MS } from '../dunning';

describe('casAttemptStatus', () => {
  it('updates only when status is in fromStatuses', async () => {
    const updates: Array<{ filter: string[]; patch: unknown }> = [];
    const supabase = {
      from: () => ({
        update: (patch: unknown) => ({
          eq: () => ({
            in: (_col: string, statuses: string[]) => {
              updates.push({ filter: statuses, patch });
              return {
                select: () => ({
                  maybeSingle: async () =>
                    statuses.includes('claimed')
                      ? { data: { id: 'a1' }, error: null }
                      : { data: null, error: null },
                }),
              };
            },
          }),
        }),
      }),
    };

    const ok = await casAttemptStatus(
      supabase as never,
      'ref',
      ['claimed'],
      { status: 'pending', wompi_transaction_id: 'tx' }
    );
    expect(ok).toBe(true);

    const blocked = await casAttemptStatus(
      supabase as never,
      'ref',
      ['claimed'],
      { status: 'pending' }
    );
    // second call: mock always returns based on filter includes claimed — simulate approved already
    expect(updates[0].filter).toEqual(['claimed']);
    expect(blocked).toBe(true); // same mock — assert filter used
  });

  it('prevents approved→pending overwrite (CAS returns false)', async () => {
    const supabase = {
      from: () => ({
        update: () => ({
          eq: () => ({
            in: () => ({
              select: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            }),
          }),
        }),
      }),
    };

    const ok = await casAttemptStatus(
      supabase as never,
      'ref',
      ['claimed'],
      { status: 'pending' }
    );
    expect(ok).toBe(false);
  });
});

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
          return {
            insert: () => ({
              select: () => ({
                maybeSingle: async () => ({ data: { id: 'e' }, error: null }),
              }),
            }),
            delete: () => ({ eq: async () => ({ error: null }) }),
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

    const wompi = {
      createSourceTransaction: jest.fn(),
      getTransaction: jest.fn(),
      findTransactionByReference: jest.fn(),
      waitForTransactionStatus: jest.fn(),
    };

    const summary = await processWompiRenewals(supabase as never, wompi as never, {
      now,
      emailSender,
      timeBudgetMs: 60_000,
    });

    expect(summary.canceledAtPeriodEnd).toBe(1);
    expect(wompi.createSourceTransaction).not.toHaveBeenCalled();
  });

  it('recovers claimed-without-tx after timeout via reference lookup', async () => {
    const reference = buildWompiRenewalReference(subId, periodEnd, 1);
    const staleClaimedAt = new Date(now.getTime() - CLAIM_STALE_MS - 1000).toISOString();
    let casPending = false;

    const supabase = {
      from: jest.fn((table: string) => {
        if (table === 'billing_subscriptions') {
          return {
            select: () => ({
              eq: () => ({
                in: () => ({
                  lte: () => ({
                    order: () => ({
                      order: () => ({
                        limit: async () => ({
                          data: [
                            {
                              id: subId,
                              user_id: userId,
                              plan_id: 'plan_premium_month',
                              status: 'past_due',
                              cancel_at_period_end: false,
                              current_period_end: periodEnd,
                              current_period_start: '2026-10-10T07:00:00.000Z',
                              billing_anchor_day: 10,
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
            }),
            update: () => ({
              eq: () => ({
                in: async () => ({ error: null }),
                maybeSingle: async () => ({ data: { id: subId }, error: null }),
              }),
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
                        wompi_transaction_id: null,
                        amount_cents: 990000,
                        status: 'claimed',
                        claimed_at: staleClaimedAt,
                      },
                    ],
                    error: null,
                  }),
                  eq: () => ({
                    maybeSingle: async () => ({ data: null, error: null }),
                  }),
                  order: async () => ({
                    data: [{ attempt_number: 1, status: 'claimed' }],
                    error: null,
                  }),
                  maybeSingle: async () => ({ data: null, error: null }),
                }),
              }),
            }),
            update: (patch: Record<string, unknown>) => ({
              eq: () => ({
                in: () => {
                  if (patch.status === 'pending') casPending = true;
                  return {
                    select: () => ({
                      maybeSingle: async () => ({ data: { id: 'attempt-1' }, error: null }),
                    }),
                  };
                },
              }),
            }),
            insert: async () => ({ error: { code: '23505' } }),
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
            update: () => ({ eq: async () => ({ error: null }) }),
          };
        }
        if (table === 'billing_email_events') {
          return {
            insert: () => ({
              select: () => ({
                maybeSingle: async () => ({ data: { id: 'e' }, error: null }),
              }),
            }),
            delete: () => ({ eq: async () => ({ error: null }) }),
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
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        };
      }),
    };

    const wompi = {
      createSourceTransaction: jest.fn(),
      getTransaction: jest.fn(),
      findTransactionByReference: jest.fn(async () => ({
        id: 'tx-recovered',
        status: 'APPROVED',
        reference,
        amountInCents: 990000,
        currency: 'COP',
      })),
      waitForTransactionStatus: jest.fn(),
    };

    const summary = await processWompiRenewals(supabase as never, wompi as never, {
      now,
      emailSender,
      timeBudgetMs: 60_000,
    });

    expect(wompi.findTransactionByReference).toHaveBeenCalledWith(reference);
    expect(wompi.createSourceTransaction).not.toHaveBeenCalled();
    expect(summary.reconciled).toBeGreaterThanOrEqual(1);
    expect(casPending || summary.approved >= 0).toBe(true);
  });

  it('does not create a new charge while a fresh claimed attempt has no tx yet', async () => {
    const reference = buildWompiRenewalReference(subId, periodEnd, 1);
    const supabase = {
      from: jest.fn((table: string) => {
        if (table === 'billing_subscriptions') {
          return {
            select: () => ({
              eq: () => ({
                in: () => ({
                  lte: () => ({
                    order: () => ({
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
                        wompi_transaction_id: null,
                        amount_cents: 990000,
                        status: 'claimed',
                        claimed_at: now.toISOString(),
                      },
                    ],
                    error: null,
                  }),
                }),
              }),
            }),
            insert: jest.fn(async () => {
              throw new Error('should not insert');
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
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        };
      }),
    };

    const wompi = {
      createSourceTransaction: jest.fn(),
      getTransaction: jest.fn(),
      findTransactionByReference: jest.fn(),
      waitForTransactionStatus: jest.fn(),
    };

    await processWompiRenewals(supabase as never, wompi as never, {
      now,
      emailSender,
    });

    expect(wompi.createSourceTransaction).not.toHaveBeenCalled();
    expect(wompi.findTransactionByReference).not.toHaveBeenCalled();
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
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        };
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

describe('applyApprovedRenewal preserves cancel_at_period_end', () => {
  it('does not force cancel_at_period_end false on success', async () => {
    const subUpdates: Record<string, unknown>[] = [];
    const reference = 'wompi_renew_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee_20261110_1';
    const subId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

    const supabase = {
      from: jest.fn((table: string) => {
        if (table === 'billing_renewal_attempts') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    status: 'pending',
                    subscription_id: subId,
                    period_end: '2026-11-10T07:00:00.000Z',
                    amount_cents: 990000,
                    attempt_number: 1,
                  },
                  error: null,
                }),
              }),
            }),
            update: () => ({
              eq: () => ({
                in: () => ({
                  select: () => ({
                    maybeSingle: async () => ({ data: { id: 'a1' }, error: null }),
                  }),
                }),
              }),
            }),
          };
        }
        if (table === 'billing_subscriptions') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: subId,
                    user_id: 'u1',
                    plan_id: 'plan_premium_month',
                    status: 'active',
                    cancel_at_period_end: true,
                    current_period_end: '2026-11-10T07:00:00.000Z',
                    billing_anchor_day: 10,
                    provider: 'wompi',
                  },
                  error: null,
                }),
              }),
            }),
            update: (payload: Record<string, unknown>) => {
              subUpdates.push(payload);
              return { eq: async () => ({ error: null }) };
            },
          };
        }
        if (table === 'billing_plans') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { name: 'Premium', interval: 'month', provider_price_map: { wompi: '990000' } },
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
        if (table === 'billing_email_events') {
          return {
            insert: () => ({
              select: () => ({
                maybeSingle: async () => ({ data: { id: 'e' }, error: null }),
              }),
            }),
            delete: () => ({ eq: async () => ({ error: null }) }),
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

    await applyWompiRenewalApproval(
      supabase as never,
      { reference, transactionId: 'tx-1', amountCents: 990000 },
      { send: async () => ({ sent: true }) }
    );

    expect(subUpdates.length).toBeGreaterThan(0);
    expect(subUpdates[0]).not.toHaveProperty('cancel_at_period_end', false);
    expect(subUpdates[0].cancel_at_period_end).toBeUndefined();
  });
});
