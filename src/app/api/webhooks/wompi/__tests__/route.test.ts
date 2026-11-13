/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';
import { POST } from '../route';

const mockVerify = jest.fn();
const mockShouldProcess = jest.fn();
const mockNormalize = jest.fn();
const mockHandleWebhookEvent = jest.fn();
const mockGetBillingService = jest.fn();

jest.mock('@/lib/billing/adapters', () => ({
  WompiWebhookNormalizer: jest.fn().mockImplementation(() => ({
    verify: mockVerify,
    shouldProcess: mockShouldProcess,
    normalize: mockNormalize,
  })),
}));

jest.mock('@/lib/billing/server', () => ({
  getBillingService: (...args: unknown[]) => mockGetBillingService(...args),
  errorResponse: (message: string, status = 400) =>
    Response.json({ error: message }, { status }),
  successResponse: (data: unknown, status = 200) =>
    Response.json(data, { status }),
}));

function buildRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/webhooks/wompi', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

describe('POST /api/webhooks/wompi', () => {
  const originalSecret = process.env.WOMPI_EVENTS_SECRET;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.WOMPI_EVENTS_SECRET = 'test_events_secret';
    mockGetBillingService.mockResolvedValue({
      handleWebhookEvent: mockHandleWebhookEvent,
    });
  });

  afterAll(() => {
    process.env.WOMPI_EVENTS_SECRET = originalSecret;
  });

  it('returns 401 when signature verification fails', async () => {
    mockVerify.mockResolvedValue({ verified: false, error: 'bad checksum' });

    const response = await POST(buildRequest({ event: 'transaction.updated' }));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Webhook verification failed');
    expect(mockHandleWebhookEvent).not.toHaveBeenCalled();
  });

  it('returns 200 for ignored unsupported events', async () => {
    mockVerify.mockResolvedValue({
      verified: true,
      event: { event: 'nequi_token.updated' },
    });
    mockShouldProcess.mockReturnValue(false);

    const response = await POST(buildRequest({ event: 'nequi_token.updated' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ received: true, processed: false });
    expect(mockHandleWebhookEvent).not.toHaveBeenCalled();
  });

  it('returns 500 when verified event processing throws', async () => {
    mockVerify.mockResolvedValue({
      verified: true,
      event: { event: 'transaction.updated' },
    });
    mockShouldProcess.mockReturnValue(true);
    mockNormalize.mockReturnValue({
      id: 'tx-1-APPROVED',
      type: 'invoice.paid',
      provider: 'wompi',
    });
    mockHandleWebhookEvent.mockRejectedValue(new Error('db write failed'));

    const response = await POST(buildRequest({ event: 'transaction.updated' }));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe('Webhook processing failed');
  });

  it('returns 200 when verified event is processed', async () => {
    mockVerify.mockResolvedValue({
      verified: true,
      event: { event: 'transaction.updated' },
    });
    mockShouldProcess.mockReturnValue(true);
    mockNormalize.mockReturnValue({
      id: 'tx-1-APPROVED',
      type: 'invoice.paid',
      provider: 'wompi',
    });
    mockHandleWebhookEvent.mockResolvedValue(undefined);

    const response = await POST(buildRequest({ event: 'transaction.updated' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ received: true, processed: true });
  });
});
