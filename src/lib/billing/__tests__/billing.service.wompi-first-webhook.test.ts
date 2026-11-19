/**
 * @jest-environment node
 */
import { buildWompiFirstReference } from '../wompi-references';

const userId = '48508890-08ea-40bc-8dc6-4a0860f6bc6a';
const planId = 'plan_premium_month';
const correctSubId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const wrongLatestSubId = '99999999-9999-9999-9999-999999999999';

jest.mock('../wompi-subscribe', () => {
  const actual = jest.requireActual('../wompi-subscribe') as Record<string, unknown>;
  return {
    ...actual,
    activateFirstCharge: jest.fn(async () => ({ activated: true })),
  };
});

import { activateFirstCharge } from '../wompi-subscribe';
import { BillingService } from '../billing.service';

const mockActivateFirstCharge = activateFirstCharge as jest.MockedFunction<
  typeof activateFirstCharge
>;

describe('BillingService first-charge webhook targets subscriptionId from reference', () => {
  beforeEach(() => {
    mockActivateFirstCharge.mockClear();
    mockActivateFirstCharge.mockResolvedValue({ activated: true });
  });

  it('activates the subscription embedded in the reference, not latest by created_at', async () => {
    const reference = buildWompiFirstReference(userId, planId, correctSubId, 1);
    const queriedById: string[] = [];

    const supabase = {
      from: jest.fn((table: string) => {
        if (table === 'billing_webhook_events') {
          return {
            update: () => ({ eq: async () => ({ error: null }) }),
          };
        }
        if (table === 'billing_subscriptions') {
          return {
            select: () => ({
              eq: (col: string, val: string) => {
                if (col === 'id') queriedById.push(val);
                const chain: Record<string, unknown> = {};
                const self = () => chain;
                chain.eq = jest.fn((c: string, v: string) => {
                  if (c === 'id') queriedById.push(v);
                  return self();
                });
                chain.order = jest.fn(() => ({
                  limit: () => ({
                    maybeSingle: async () => ({
                      data: {
                        id: wrongLatestSubId,
                        status: 'incomplete',
                        current_period_end: null,
                      },
                      error: null,
                    }),
                  }),
                }));
                chain.maybeSingle = jest.fn(async () => ({
                  data: {
                    id: correctSubId,
                    status: 'incomplete',
                    current_period_end: null,
                  },
                  error: null,
                }));
                return chain;
              },
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
                    features: {
                      max_assets: -1,
                      max_beneficiaries: 10,
                      max_file_size_mb: 100,
                      max_storage_mb: 5000,
                      priority_support: true,
                      advanced_security: true,
                    },
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

    const gateway = {
      getName: () => 'wompi' as const,
    };

    const service = new BillingService(supabase as never, gateway as never);

    await service.processWebhookEvent(
      {
        type: 'invoice.paid',
        provider: 'wompi',
        data: {
          invoiceId: reference,
          amountCents: 490000,
          currency: 'COP',
          userId,
          planId,
          providerTransactionId: 'tx-webhook',
          issuedAt: new Date().toISOString(),
          paidAt: new Date().toISOString(),
        },
      } as never,
      'evt-test-1'
    );

    expect(queriedById).toContain(correctSubId);
    expect(mockActivateFirstCharge).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        subscriptionId: correctSubId,
        reference,
        transactionId: 'tx-webhook',
      })
    );
    expect(mockActivateFirstCharge).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ subscriptionId: wrongLatestSubId })
    );
  });
});
