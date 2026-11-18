/**
 * @jest-environment node
 */

const processWompiRenewals = jest.fn();
const getPaymentGateway = jest.fn();

jest.mock('@/lib/billing/renewals', () => ({
  processWompiRenewals: (...args: unknown[]) => processWompiRenewals(...args),
}));

jest.mock('@/lib/billing/server', () => ({
  getPaymentGateway: () => getPaymentGateway(),
  errorResponse: (message: string, status = 400) =>
    Response.json({ error: message }, { status }),
  successResponse: (data: unknown, status = 200) =>
    Response.json(data, { status }),
}));

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({ from: jest.fn() })),
}));

describe('GET /api/cron/billing-renewals', () => {
  const originalSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    jest.resetModules();
    processWompiRenewals.mockReset();
    getPaymentGateway.mockReset();
    process.env.CRON_SECRET = 'test-cron-secret';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
  });

  afterAll(() => {
    process.env.CRON_SECRET = originalSecret;
  });

  async function loadRoute() {
    return import('../route');
  }

  it('returns 500 when CRON_SECRET is unset', async () => {
    delete process.env.CRON_SECRET;
    const { GET } = await loadRoute();
    const res = await GET(new Request('http://localhost/api/cron/billing-renewals'));
    expect(res.status).toBe(500);
  });

  it('returns 401 when Authorization mismatches (timing-safe path)', async () => {
    const { GET } = await loadRoute();
    const res = await GET(
      new Request('http://localhost/api/cron/billing-renewals', {
        headers: { Authorization: 'Bearer wrong' },
      })
    );
    expect(res.status).toBe(401);
  });

  it('returns 401 for empty Authorization', async () => {
    const { GET } = await loadRoute();
    const res = await GET(
      new Request('http://localhost/api/cron/billing-renewals')
    );
    expect(res.status).toBe(401);
  });

  it('runs renewals with time budget when authorized and gateway is wompi', async () => {
    getPaymentGateway.mockReturnValue({
      getName: () => 'wompi',
    });
    processWompiRenewals.mockResolvedValue({
      scanned: 1,
      charged: 1,
      approved: 1,
      failed: 0,
      downgraded: 0,
      canceledAtPeriodEnd: 0,
      upcomingEmails: 0,
      reconciled: 0,
      skipped: 0,
      batches: 1,
      errors: [],
    });

    const { GET } = await loadRoute();
    const res = await GET(
      new Request('http://localhost/api/cron/billing-renewals', {
        headers: { Authorization: 'Bearer test-cron-secret' },
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(processWompiRenewals).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ timeBudgetMs: 240_000 })
    );
  });

  it('skips when gateway is not wompi', async () => {
    getPaymentGateway.mockReturnValue({ getName: () => 'payu' });
    const { GET } = await loadRoute();
    const res = await GET(
      new Request('http://localhost/api/cron/billing-renewals', {
        headers: { Authorization: 'Bearer test-cron-secret' },
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.skipped).toBe(true);
    expect(processWompiRenewals).not.toHaveBeenCalled();
  });
});
