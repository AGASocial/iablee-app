import { GET } from '../route';
import { createClient } from '@supabase/supabase-js';

jest.mock('@supabase/supabase-js');

describe('/api/billing/plans', () => {
  const mockSupabase = {
    from: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
    (createClient as jest.Mock).mockReturnValue(mockSupabase);
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  it('should return plans successfully', async () => {
    const mockPlans = [
      {
        id: 'plan-1',
        name: 'Basic',
        currency: 'usd',
        amount_cents: 1000,
        interval: 'month',
        features: ['feature1'],
        provider_price_map: { stripe: 'price_123' },
      },
    ];

    const mockOrder = jest.fn().mockResolvedValue({
      data: mockPlans,
      error: null,
    });

    mockSupabase.from = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        order: mockOrder,
      }),
    });

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.plans).toHaveLength(1);
    expect(data.data.plans[0]).toEqual({
      id: 'plan-1',
      name: 'Basic',
      currency: 'usd',
      amountCents: 1000,
      interval: 'month',
      features: ['feature1'],
      providerPriceMap: { stripe: 'price_123' },
    });
  });

  it('should return error when Supabase URL is missing', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.success).toBe(false);
    expect(data.error).toContain('configuration error');
  });

  it('should return error when service key is missing', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.success).toBe(false);
  });

  it('should handle database errors', async () => {
    const mockOrder = jest.fn().mockResolvedValue({
      data: null,
      error: { message: 'Database error' },
    });

    mockSupabase.from = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        order: mockOrder,
      }),
    });

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.success).toBe(false);
    expect(data.error).toContain('Failed to fetch plans');
  });

  it('should return empty array when no plans exist', async () => {
    const mockOrder = jest.fn().mockResolvedValue({
      data: [],
      error: null,
    });

    mockSupabase.from = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        order: mockOrder,
      }),
    });

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.data.plans).toEqual([]);
  });

  it('should sort plans by amount_cents ascending', async () => {
    const mockOrder = jest.fn().mockResolvedValue({
      data: [
        { id: 'plan-2', amount_cents: 2000 },
        { id: 'plan-1', amount_cents: 1000 },
      ],
      error: null,
    });

    mockSupabase.from = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        order: mockOrder,
      }),
    });

    await GET();

    expect(mockOrder).toHaveBeenCalledWith('amount_cents', { ascending: true });
  });
});

