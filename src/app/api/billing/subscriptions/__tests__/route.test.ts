/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';
import { POST, PATCH, DELETE } from '../route';
import { PlanNotPurchasableError } from '@/lib/billing/types';

const mockGetAuthenticatedUserId = jest.fn();
const mockCreateSubscription = jest.fn();
const mockUpdateSubscription = jest.fn();
const mockGetUserSubscription = jest.fn();
const mockCancelSubscription = jest.fn();

jest.mock('@/lib/billing/server', () => ({
  getAuthenticatedUserId: (...args: unknown[]) => mockGetAuthenticatedUserId(...args),
  getBillingService: jest.fn(async () => ({
    createSubscription: mockCreateSubscription,
    updateSubscription: mockUpdateSubscription,
    getUserSubscription: mockGetUserSubscription,
    cancelSubscription: mockCancelSubscription,
  })),
  errorResponse: (message: string, status = 400) =>
    Response.json({ error: message }, { status }),
  successResponse: (data: unknown, status = 200) => Response.json(data, { status }),
}));

describe('/api/billing/subscriptions hidden-plan gating (KAN-164)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAuthenticatedUserId.mockResolvedValue('user-1');
  });

  it('rejects POST onto a hidden plan for new purchases', async () => {
    mockCreateSubscription.mockRejectedValue(
      new PlanNotPurchasableError('plan_necessary_month')
    );

    const request = new NextRequest('http://localhost/api/billing/subscriptions', {
      method: 'POST',
      body: JSON.stringify({ planId: 'plan_necessary_month' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toMatch(/not available for purchase/i);
    expect(mockCreateSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ planId: 'plan_necessary_month', userId: 'user-1' })
    );
  });

  it('allows POST when service accepts same-plan Necessary renewal', async () => {
    mockCreateSubscription.mockResolvedValue({
      subscriptionId: 'sub-1',
      providerSubscriptionId: 'prov-1',
      status: 'incomplete',
    });

    const request = new NextRequest('http://localhost/api/billing/subscriptions', {
      method: 'POST',
      body: JSON.stringify({ planId: 'plan_necessary_month' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(request);
    expect(response.status).toBe(201);
  });

  it('rejects PATCH upgrade onto a hidden plan', async () => {
    mockGetUserSubscription.mockResolvedValue({
      id: 'sub-1',
      planId: 'plan_premium_month',
    });
    mockUpdateSubscription.mockRejectedValue(
      new PlanNotPurchasableError('plan_necessary_month')
    );

    const request = new NextRequest('http://localhost/api/billing/subscriptions', {
      method: 'PATCH',
      body: JSON.stringify({
        subscriptionId: 'sub-1',
        planId: 'plan_necessary_month',
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await PATCH(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toMatch(/not available for purchase/i);
  });
});

describe('/api/billing/subscriptions DELETE cancel defaults (KAN-168)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAuthenticatedUserId.mockResolvedValue('user-1');
    mockGetUserSubscription.mockResolvedValue({ id: 'sub-1', planId: 'plan_premium_month' });
    mockCancelSubscription.mockResolvedValue(undefined);
  });

  it('defaults atPeriodEnd=true when query param omitted', async () => {
    const request = new NextRequest(
      'http://localhost/api/billing/subscriptions?subscriptionId=sub-1',
      { method: 'DELETE' }
    );
    const response = await DELETE(request);
    expect(response.status).toBe(200);
    expect(mockCancelSubscription).toHaveBeenCalledWith({
      subscriptionId: 'sub-1',
      atPeriodEnd: true,
    });
  });

  it('immediate cancel only when atPeriodEnd=false explicitly', async () => {
    const request = new NextRequest(
      'http://localhost/api/billing/subscriptions?subscriptionId=sub-1&atPeriodEnd=false',
      { method: 'DELETE' }
    );
    const response = await DELETE(request);
    expect(response.status).toBe(200);
    expect(mockCancelSubscription).toHaveBeenCalledWith({
      subscriptionId: 'sub-1',
      atPeriodEnd: false,
    });
  });

  it('treats non-false atPeriodEnd values as period-end (strict parse)', async () => {
    for (const raw of ['0', 'no', 'False', 'TRUE', 'true', '']) {
      mockCancelSubscription.mockClear();
      const request = new NextRequest(
        `http://localhost/api/billing/subscriptions?subscriptionId=sub-1&atPeriodEnd=${encodeURIComponent(raw)}`,
        { method: 'DELETE' }
      );
      const response = await DELETE(request);
      expect(response.status).toBe(200);
      expect(mockCancelSubscription).toHaveBeenCalledWith({
        subscriptionId: 'sub-1',
        atPeriodEnd: true,
      });
    }
  });
});

describe('/api/billing/subscriptions DELETE ownership (KAN-168 past_due)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAuthenticatedUserId.mockResolvedValue('user-1');
    mockCancelSubscription.mockResolvedValue(undefined);
  });

  it('allows DELETE when management current sub is Stripe past_due matching id', async () => {
    mockGetUserSubscription.mockResolvedValue({
      id: 'sub-past-due',
      planId: 'plan_premium_month',
      status: 'past_due',
      provider: 'stripe',
    });

    const request = new NextRequest(
      'http://localhost/api/billing/subscriptions?subscriptionId=sub-past-due',
      { method: 'DELETE' }
    );
    const response = await DELETE(request);
    expect(response.status).toBe(200);
    expect(mockCancelSubscription).toHaveBeenCalledWith({
      subscriptionId: 'sub-past-due',
      atPeriodEnd: true,
    });
  });

  it('404s DELETE when past_due management sub id does not match', async () => {
    mockGetUserSubscription.mockResolvedValue({
      id: 'sub-past-due',
      planId: 'plan_premium_month',
      status: 'past_due',
      provider: 'stripe',
    });

    const request = new NextRequest(
      'http://localhost/api/billing/subscriptions?subscriptionId=sub-other',
      { method: 'DELETE' }
    );
    const response = await DELETE(request);
    const data = await response.json();
    expect(response.status).toBe(404);
    expect(data.error).toMatch(/not found/i);
    expect(mockCancelSubscription).not.toHaveBeenCalled();
  });
});
