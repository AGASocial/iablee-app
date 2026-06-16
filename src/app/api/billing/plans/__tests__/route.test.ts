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
    const mockFrom = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({ order: mockOrder }),
    });
    mockGetBillingService.mockResolvedValue({
      getSupabaseClient: () => ({ from: mockFrom }),
    });
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
    });
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
