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
  existingSubscription: Record<string, unknown> | null;
}) {
  const planRow = {
    id: 'plan_necessary_month',
    name: 'Necessary',
    currency: 'USD',
    amount_cents: 999,
    interval: 'month',
    features: {},
    provider_price_map: { wompi: '4000000' },
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
      service.createSubscription({ userId: 'user-existing', planId: 'plan_necessary_month' })
    ).resolves.toMatchObject({
      subscriptionId: 'sub-1',
      checkoutSession: expect.objectContaining({ provider: 'wompi' }),
    });
  });
});
