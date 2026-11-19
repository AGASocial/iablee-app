/**
 * @jest-environment node
 */
import { BillingService } from '../billing.service';
import { PlanNotPurchasableError } from '../types';
import type { PaymentGateway } from '../gateway.interface';

function makeGateway(overrides: Partial<PaymentGateway> = {}): PaymentGateway {
  return {
    getName: () => 'wompi',
    createCustomer: jest.fn(),
    attachPaymentMethod: jest.fn(),
    setDefaultPaymentMethod: jest.fn(),
    createSubscription: jest.fn(),
    updateSubscription: jest.fn(),
    cancelSubscription: jest.fn(),
    createCheckoutSession: jest.fn().mockResolvedValue({
      sessionId: 'sess',
      url: 'https://checkout.wompi.co/p/',
      formFields: { 'public-key': 'x' },
      formMethod: 'GET',
    }),
    createBillingPortalSession: jest.fn(),
    listInvoices: jest.fn(),
    getInvoice: jest.fn(),
    ...overrides,
  } as unknown as PaymentGateway;
}

/** Minimal thenable query builder for BillingService supabase calls. */
function createSupabaseMock(opts: {
  planVisible: boolean;
  planId?: string;
  planInterval?: 'month' | 'year';
  existingSubscription: Record<string, unknown> | null;
}) {
  const planId = opts.planId ?? 'plan_necessary_month';
  const planRow = {
    id: planId,
    name: 'Necessary',
    currency: 'USD',
    amount_cents: opts.planInterval === 'year' ? 9990 : 999,
    interval: opts.planInterval ?? 'month',
    features: {},
    provider_price_map: {
      wompi: opts.planInterval === 'year' ? '8000000' : '4000000',
    },
    is_visible: opts.planVisible,
  };

  const chain = (): Record<string, unknown> => {
    const api: Record<string, unknown> = {};
    const self = () => api;
    api.select = jest.fn(self);
    api.insert = jest.fn(self);
    api.update = jest.fn(self);
    api.upsert = jest.fn(self);
    api.eq = jest.fn(self);
    api.in = jest.fn(self);
    api.order = jest.fn(self);
    api.limit = jest.fn(self);
    api.single = jest.fn(async () => {
      // Heuristic: billing_plans vs users vs invoices
      return { data: planRow, error: null };
    });
    api.maybeSingle = jest.fn(async () => ({
      data: opts.existingSubscription,
      error: null,
    }));
    return api;
  };

  return {
    from: jest.fn((table: string) => {
      const api = chain();
      if (table === 'users') {
        api.single = jest.fn(async () => ({
          data: { email: 'a@b.com', full_name: 'A' },
          error: null,
        }));
      }
      if (table === 'billing_plans') {
        api.single = jest.fn(async () => ({ data: planRow, error: null }));
      }
      if (table === 'billing_subscriptions') {
        // getUserSubscription awaits .limit(N); other paths use .limit().maybeSingle().
        api.limit = jest.fn(() => {
          const listResult = {
            data: opts.existingSubscription ? [opts.existingSubscription] : [],
            error: null,
          };
          return {
            maybeSingle: jest.fn(async () => ({
              data: opts.existingSubscription,
              error: null,
            })),
            then: (
              resolve: (v: unknown) => unknown,
              reject?: (e: unknown) => unknown
            ) => Promise.resolve(listResult).then(resolve, reject),
          };
        });
        api.maybeSingle = jest.fn(async () => ({
          data: opts.existingSubscription,
          error: null,
        }));
        api.single = jest.fn(async () => ({
          data: opts.existingSubscription ?? { id: 'sub-new', status: 'incomplete' },
          error: null,
        }));
      }
      if (table === 'billing_invoices') {
        api.single = jest.fn(async () => ({ data: { id: 'inv-1' }, error: null }));
        // insert(). — createWompiCheckout uses insert without select
        api.insert = jest.fn(async () => ({ error: null }));
      }
      return api;
    }),
  };
}

describe('BillingService plan visibility (KAN-164)', () => {
  it('rejects createSubscription onto a hidden plan for new buyers', async () => {
    const supabase = createSupabaseMock({
      planVisible: false,
      existingSubscription: null,
    });
    const service = new BillingService(supabase as never, makeGateway());

    await expect(
      service.createSubscription({ userId: 'user-new', planId: 'plan_necessary_month' })
    ).rejects.toBeInstanceOf(PlanNotPurchasableError);
  });

  it('allows createSubscription renewal for an existing Necessary subscriber', async () => {
    const existing = {
      id: 'sub-1',
      user_id: 'user-existing',
      plan_id: 'plan_necessary_month',
      status: 'active',
      provider: 'wompi',
      provider_subscription_id: 'prov-1',
      cancel_at_period_end: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const supabase = createSupabaseMock({
      planVisible: false,
      existingSubscription: existing,
    });
    const service = new BillingService(supabase as never, makeGateway());

    await expect(
      service.createSubscription({
        userId: 'user-existing',
        planId: 'plan_necessary_month',
        // Visibility tests still exercise legacy Web Checkout path
        paymentMethodToken: '__legacy_web_checkout__',
      })
    ).resolves.toMatchObject({
      subscriptionId: 'sub-1',
      checkoutSession: expect.objectContaining({ provider: 'wompi' }),
    });
  });

  it('allows Necessary month → year switch for an existing Necessary subscriber', async () => {
    const existing = {
      id: 'sub-1',
      user_id: 'user-necessary',
      plan_id: 'plan_necessary_month',
      status: 'active',
      provider: 'wompi',
      provider_subscription_id: 'prov-1',
      cancel_at_period_end: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const supabase = createSupabaseMock({
      planVisible: false,
      planId: 'plan_necessary_year',
      planInterval: 'year',
      existingSubscription: existing,
    });
    const service = new BillingService(supabase as never, makeGateway());

    await expect(
      service.createSubscription({
        userId: 'user-necessary',
        planId: 'plan_necessary_year',
        paymentMethodToken: '__legacy_web_checkout__',
      })
    ).resolves.toMatchObject({
      subscriptionId: 'sub-1',
      checkoutSession: expect.objectContaining({ provider: 'wompi' }),
    });
  });

  it('rejects Necessary purchase when current plan is Premium', async () => {
    const existing = {
      id: 'sub-prem',
      user_id: 'user-premium',
      plan_id: 'plan_premium_month',
      status: 'active',
      provider: 'wompi',
      provider_subscription_id: 'prov-prem',
      cancel_at_period_end: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const supabase = createSupabaseMock({
      planVisible: false,
      existingSubscription: existing,
    });
    const service = new BillingService(supabase as never, makeGateway());

    await expect(
      service.createSubscription({ userId: 'user-premium', planId: 'plan_necessary_month' })
    ).rejects.toBeInstanceOf(PlanNotPurchasableError);
  });
});

describe('BillingService getUserSubscription management lookup (KAN-168)', () => {
  function makeListSupabase(rows: Record<string, unknown>[]) {
    return {
      from: jest.fn(() => {
        const api: Record<string, unknown> = {};
        const self = () => api;
        api.select = jest.fn(self);
        api.eq = jest.fn(self);
        api.in = jest.fn(self);
        api.order = jest.fn(self);
        api.limit = jest.fn(() => ({
          then: (
            resolve: (v: unknown) => unknown,
            reject?: (e: unknown) => unknown
          ) => Promise.resolve({ data: rows, error: null }).then(resolve, reject),
        }));
        return api;
      }),
    };
  }

  it('returns Stripe past_due even though it does not grant entitlements', async () => {
    const pastDue = {
      id: 'sub-past-due',
      user_id: 'user-1',
      plan_id: 'plan_premium_month',
      status: 'past_due',
      provider: 'stripe',
      provider_subscription_id: 'sub_stripe_pd',
      cancel_at_period_end: false,
      current_period_end: '2026-11-10T00:00:00.000Z',
      created_at: '2026-10-01T00:00:00.000Z',
      updated_at: '2026-11-11T00:00:00.000Z',
    };
    const service = new BillingService(
      makeListSupabase([pastDue]) as never,
      makeGateway({ getName: () => 'stripe' })
    );

    const sub = await service.getUserSubscription('user-1');
    expect(sub).toMatchObject({
      id: 'sub-past-due',
      status: 'past_due',
      planId: 'plan_premium_month',
      provider: 'stripe',
    });
  });

  it('prefers past_due over a newer CAPE canceled row', async () => {
    const rows = [
      {
        id: 'sub-cape',
        user_id: 'user-1',
        plan_id: 'plan_premium_month',
        status: 'canceled',
        provider: 'stripe',
        provider_subscription_id: 'sub_old',
        cancel_at_period_end: true,
        current_period_end: '2026-12-01T00:00:00.000Z',
        created_at: '2026-11-01T00:00:00.000Z',
        updated_at: '2026-11-15T00:00:00.000Z',
      },
      {
        id: 'sub-past-due',
        user_id: 'user-1',
        plan_id: 'plan_premium_month',
        status: 'past_due',
        provider: 'stripe',
        provider_subscription_id: 'sub_pd',
        cancel_at_period_end: false,
        current_period_end: '2026-11-10T00:00:00.000Z',
        created_at: '2026-10-01T00:00:00.000Z',
        updated_at: '2026-11-11T00:00:00.000Z',
      },
    ];
    const service = new BillingService(
      makeListSupabase(rows) as never,
      makeGateway({ getName: () => 'stripe' })
    );

    const sub = await service.getUserSubscription('user-1');
    expect(sub?.id).toBe('sub-past-due');
  });

  it('falls back to CAPE paid-through canceled when no chargeable row', async () => {
    const cape = {
      id: 'sub-cape',
      user_id: 'user-1',
      plan_id: 'plan_premium_month',
      status: 'canceled',
      provider: 'stripe',
      provider_subscription_id: 'sub_cape',
      cancel_at_period_end: true,
      canceled_reason: 'user',
      current_period_end: '2099-12-01T00:00:00.000Z',
      created_at: '2026-11-01T00:00:00.000Z',
      updated_at: '2026-11-15T00:00:00.000Z',
    };
    const service = new BillingService(
      makeListSupabase([cape]) as never,
      makeGateway({ getName: () => 'stripe' })
    );

    const sub = await service.getUserSubscription('user-1');
    expect(sub?.id).toBe('sub-cape');
  });
});
