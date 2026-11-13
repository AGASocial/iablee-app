/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';
import { GET } from '../route';

const mockGetAuthenticatedUserId = jest.fn();
const mockGetTransaction = jest.fn();
const mockParseWompiReference = jest.fn();

jest.mock('@/lib/billing/server', () => ({
  getAuthenticatedUserId: (...args: unknown[]) => mockGetAuthenticatedUserId(...args),
  errorResponse: (message: string, status = 400) =>
    Response.json({ error: message }, { status }),
  successResponse: (data: unknown, status = 200) =>
    Response.json(data, { status }),
}));

jest.mock('@/lib/billing/adapters', () => ({
  WompiAdapter: jest.fn().mockImplementation(() => ({
    getTransaction: mockGetTransaction,
  })),
  parseWompiReference: (...args: unknown[]) => mockParseWompiReference(...args),
}));

function buildRequest(id?: string): NextRequest {
  const url = id
    ? `http://localhost/api/payments/wompi/transaction?id=${encodeURIComponent(id)}`
    : 'http://localhost/api/payments/wompi/transaction';
  return new NextRequest(url, { method: 'GET' });
}

describe('GET /api/payments/wompi/transaction', () => {
  const originalEnv = {
    WOMPI_PUBLIC_KEY: process.env.WOMPI_PUBLIC_KEY,
    WOMPI_PRIVATE_KEY: process.env.WOMPI_PRIVATE_KEY,
    WOMPI_INTEGRITY_SECRET: process.env.WOMPI_INTEGRITY_SECRET,
    WOMPI_ENV: process.env.WOMPI_ENV,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.WOMPI_PUBLIC_KEY = 'pub_test';
    process.env.WOMPI_PRIVATE_KEY = 'prv_test';
    process.env.WOMPI_INTEGRITY_SECRET = 'int_test';
    process.env.WOMPI_ENV = 'sandbox';
  });

  afterAll(() => {
    process.env.WOMPI_PUBLIC_KEY = originalEnv.WOMPI_PUBLIC_KEY;
    process.env.WOMPI_PRIVATE_KEY = originalEnv.WOMPI_PRIVATE_KEY;
    process.env.WOMPI_INTEGRITY_SECRET = originalEnv.WOMPI_INTEGRITY_SECRET;
    process.env.WOMPI_ENV = originalEnv.WOMPI_ENV;
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetAuthenticatedUserId.mockResolvedValue(null);

    const response = await GET(buildRequest('tx-1'));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
    expect(mockGetTransaction).not.toHaveBeenCalled();
  });

  it('returns 404 when reference cannot be parsed (deny leak)', async () => {
    mockGetAuthenticatedUserId.mockResolvedValue('user-a');
    mockGetTransaction.mockResolvedValue({
      id: 'tx-1',
      status: 'APPROVED',
      reference: 'opaque-ref',
      amountInCents: 1000,
      currency: 'COP',
    });
    mockParseWompiReference.mockReturnValue(null);

    const response = await GET(buildRequest('tx-1'));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('Transaction not found');
  });

  it('returns 403 when reference belongs to another user', async () => {
    mockGetAuthenticatedUserId.mockResolvedValue('user-a');
    mockGetTransaction.mockResolvedValue({
      id: 'tx-1',
      status: 'APPROVED',
      reference: 'wompi_user-b_plan_premium_month_1',
      amountInCents: 1000,
      currency: 'COP',
    });
    mockParseWompiReference.mockReturnValue({
      userId: 'user-b',
      planId: 'plan_premium_month',
      timestamp: '1',
    });

    const response = await GET(buildRequest('tx-1'));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe('Forbidden');
  });

  it('returns transaction when session owns the reference', async () => {
    mockGetAuthenticatedUserId.mockResolvedValue('user-a');
    mockGetTransaction.mockResolvedValue({
      id: 'tx-1',
      status: 'APPROVED',
      reference: 'wompi_user-a_plan_premium_month_1',
      amountInCents: 19900,
      currency: 'COP',
    });
    mockParseWompiReference.mockReturnValue({
      userId: 'user-a',
      planId: 'plan_premium_month',
      timestamp: '1',
    });

    const response = await GET(buildRequest('tx-1'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      id: 'tx-1',
      status: 'APPROVED',
      reference: 'wompi_user-a_plan_premium_month_1',
      amountInCents: 19900,
      currency: 'COP',
    });
  });
});
