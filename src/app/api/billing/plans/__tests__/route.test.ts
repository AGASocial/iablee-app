/**
 * @jest-environment node
 */
import { GET } from '../route';

const mockGetBillingService = jest.fn();

jest.mock('@/lib/billing/server', () => ({
  getBillingService: (...args: unknown[]) => mockGetBillingService(...args),
  errorResponse: (message: string, status = 400) =>
    Response.json({ error: message }, { status }),
  successResponse: (data: unknown, status = 200, headers?: Record<string, string>) =>
    Response.json(data, { status, headers }),
}));

describe('/api/billing/plans', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function mockBillingQuery(plans: unknown[] | null, error: { message: string } | null = null) {
    const mockOrder = jest.fn().mockResolvedValue({ data: plans, error });
    const mockEq = jest.fn().mockReturnValue({ order: mockOrder });
    const mockSelect = jest.fn().mockReturnValue({ eq: mockEq });
    const mockFrom = jest.fn().mockReturnValue({ select: mockSelect });
    mockGetBillingService.mockResolvedValue({
      getSupabaseClient: () => ({ from: mockFrom }),
    });
    return { mockFrom, mockSelect, mockEq, mockOrder };
  }

  it('should return plans successfully with cache headers', async () => {
    mockBillingQuery([
      {
        id: 'plan-1',
        name: 'Basic',
        currency: 'usd',
        amount_cents: 1000,
        interval: 'month',
        features: ['feature1'],
        provider_price_map: { stripe: 'price_123' },
        is_visible: true,
      },
    ]);

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toContain('s-maxage=3600');
    expect(data.plans).toHaveLength(1);
    expect(data.plans[0]).toEqual({
      id: 'plan-1',
      name: 'Basic',
      currency: 'usd',
      amountCents: 1000,
      interval: 'month',
      features: ['feature1'],
      providerPriceMap: { stripe: 'price_123' },
      isVisible: true,
    });
  });

  it('filters to is_visible=true so hidden plans are not returned', async () => {
    const { mockEq } = mockBillingQuery([
      {
        id: 'plan_free',
        name: 'Free',
        currency: 'USD',
        amount_cents: 0,
        interval: 'month',
        features: {},
        provider_price_map: {},
        is_visible: true,
      },
      {
        id: 'plan_premium_month',
        name: 'Premium',
        currency: 'USD',
        amount_cents: 1999,
        interval: 'month',
        features: {},
        provider_price_map: { wompi: '990000' },
        is_visible: true,
      },
    ]);

    const response = await GET();
    const data = await response.json();

    expect(mockEq).toHaveBeenCalledWith('is_visible', true);
    expect(response.status).toBe(200);
    expect(data.plans.map((p: { id: string }) => p.id)).toEqual([
      'plan_free',
      'plan_premium_month',
    ]);
    expect(data.plans.every((p: { isVisible: boolean }) => p.isVisible)).toBe(true);
  });

  it('should handle database errors', async () => {
    mockBillingQuery(null, { message: 'Database error' });

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toContain('Failed to fetch plans');
  });

  it('should return empty array when no plans exist', async () => {
    mockBillingQuery([]);

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.plans).toEqual([]);
  });
});
