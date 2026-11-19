/**
 * @jest-environment node
 *
 * KAN-168: Stripe subscription.updated / subscription.deleted CAPE preservation.
 */
import { BillingService } from '../billing.service';
import type { NormalizedEvent, SubscriptionEventData } from '../types';

type SubRow = {
  id: string;
  cancel_at_period_end: boolean;
  current_period_end: string;
  status?: string;
};

function makeStripeGateway() {
  return { getName: () => 'stripe' } as never;
}

function makeSubSupabase(opts: {
  getRow: () => SubRow | null;
  onUpdate: (patch: Record<string, unknown>) => void;
}) {
  return {
    from: jest.fn((table: string) => {
      if (table === 'billing_webhook_events') {
        return {
          update: () => ({
            eq: async () => ({ error: null }),
          }),
        };
      }
      if (table !== 'billing_subscriptions') {
        return {
          select: () => ({
            eq: () => ({
              limit: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        };
      }

      const chain: Record<string, unknown> = {};
      const self = () => chain;
      chain.select = jest.fn(self);
      chain.eq = jest.fn(self);
      chain.in = jest.fn(self);
      chain.order = jest.fn(self);
      chain.limit = jest.fn(self);
      chain.maybeSingle = jest.fn(async () => ({
        data: opts.getRow(),
        error: null,
      }));
      chain.update = jest.fn((patch: Record<string, unknown>) => {
        opts.onUpdate(patch);
        const row = opts.getRow();
        if (row) {
          Object.assign(row, patch);
        }
        return {
          eq: jest.fn(async () => ({ error: null })),
        };
      });
      return chain;
    }),
  };
}

function subEvent(
  type: 'subscription.updated' | 'subscription.canceled',
  data: Partial<SubscriptionEventData> & { subscriptionId: string }
): NormalizedEvent<SubscriptionEventData> {
  return {
    id: `evt-${type}-${data.subscriptionId}`,
    type,
    provider: 'stripe',
    occurredAt: new Date().toISOString(),
    raw: {},
    data: {
      customerId: 'cus_1',
      status: 'canceled',
      ...data,
    },
  };
}

describe('KAN-168 Stripe webhook CAPE (subscription.updated / deleted)', () => {
  const futureCpe = new Date(Date.now() + 3 * 86400000).toISOString();
  const nowIso = new Date().toISOString();

  it('subscription.deleted with DB CAPE true keeps CAPE/CPE (even if CPE still future)', async () => {
    const row: SubRow = {
      id: 'sub-local',
      cancel_at_period_end: true,
      current_period_end: futureCpe,
      status: 'active',
    };
    const updates: Record<string, unknown>[] = [];
    const supabase = makeSubSupabase({
      getRow: () => row,
      onUpdate: (patch) => updates.push(patch),
    });
    const service = new BillingService(supabase as never, makeStripeGateway());

    await service.processWebhookEvent(
      subEvent('subscription.canceled', {
        subscriptionId: 'sub_stripe_1',
        status: 'canceled',
        canceledAt: nowIso,
        cancelAtPeriodEnd: false,
      }),
      'evt-row-1'
    );

    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      status: 'canceled',
      canceled_at: nowIso,
    });
    expect(updates[0]).not.toHaveProperty('cancel_at_period_end');
    expect(updates[0]).not.toHaveProperty('current_period_end');
    expect(row.cancel_at_period_end).toBe(true);
    expect(row.current_period_end).toBe(futureCpe);
  });

  it('subscription.deleted with DB CAPE false clamps CPE (mid-period force-cancel)', async () => {
    const row: SubRow = {
      id: 'sub-local',
      cancel_at_period_end: false,
      current_period_end: futureCpe,
      status: 'active',
    };
    const updates: Record<string, unknown>[] = [];
    const supabase = makeSubSupabase({
      getRow: () => row,
      onUpdate: (patch) => updates.push(patch),
    });
    const service = new BillingService(supabase as never, makeStripeGateway());

    await service.processWebhookEvent(
      subEvent('subscription.canceled', {
        subscriptionId: 'sub_stripe_2',
        status: 'canceled',
        canceledAt: nowIso,
      }),
      'evt-row-2'
    );

    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      status: 'canceled',
      cancel_at_period_end: false,
      current_period_end: nowIso,
      canceled_at: nowIso,
    });
  });

  it('subscription.updated canceled without CAPE flag does not clear existing DB CAPE', async () => {
    const row: SubRow = {
      id: 'sub-local',
      cancel_at_period_end: true,
      current_period_end: futureCpe,
      status: 'active',
    };
    const updates: Record<string, unknown>[] = [];
    const supabase = makeSubSupabase({
      getRow: () => row,
      onUpdate: (patch) => updates.push(patch),
    });
    const service = new BillingService(supabase as never, makeStripeGateway());

    await service.processWebhookEvent(
      subEvent('subscription.updated', {
        subscriptionId: 'sub_stripe_3',
        status: 'canceled',
        // Stripe canceled objects often omit / falsify the flag
        cancelAtPeriodEnd: false,
        currentPeriodEnd: futureCpe,
        userId: 'user-1',
      }),
      'evt-row-3'
    );

    expect(updates).toHaveLength(1);
    expect(updates[0].cancel_at_period_end).toBe(true);
    expect(updates[0].status).toBe('canceled');
    expect(row.cancel_at_period_end).toBe(true);
  });

  it('ordering updated(CAPE false on canceled) → deleted near period end keeps paid-through', async () => {
    const nearEndCpe = new Date(Date.now() + 30_000).toISOString();
    const row: SubRow = {
      id: 'sub-local',
      cancel_at_period_end: true,
      current_period_end: nearEndCpe,
      status: 'active',
    };
    const updates: Record<string, unknown>[] = [];
    const supabase = makeSubSupabase({
      getRow: () => row,
      onUpdate: (patch) => updates.push({ ...patch }),
    });
    const service = new BillingService(supabase as never, makeStripeGateway());

    await service.processWebhookEvent(
      subEvent('subscription.updated', {
        subscriptionId: 'sub_stripe_4',
        status: 'canceled',
        cancelAtPeriodEnd: false,
        currentPeriodEnd: nearEndCpe,
        userId: 'user-1',
      }),
      'evt-row-4a'
    );

    await service.processWebhookEvent(
      subEvent('subscription.canceled', {
        subscriptionId: 'sub_stripe_4',
        status: 'canceled',
        canceledAt: nowIso,
        cancelAtPeriodEnd: false,
      }),
      'evt-row-4b'
    );

    expect(updates[0].cancel_at_period_end).toBe(true);
    expect(updates[1]).toMatchObject({ status: 'canceled' });
    expect(updates[1]).not.toHaveProperty('cancel_at_period_end', false);
    expect(updates[1]).not.toHaveProperty('current_period_end');
    expect(row.cancel_at_period_end).toBe(true);
    expect(row.current_period_end).toBe(nearEndCpe);
  });
});
