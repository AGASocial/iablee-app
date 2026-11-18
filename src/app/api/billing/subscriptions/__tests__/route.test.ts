/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';
import { POST, PATCH } from '../route';
import { PlanNotPurchasableError } from '@/lib/billing/types';

const mockGetAuthenticatedUserId = jest.fn();
const mockCreateSubscription = jest.fn();
const mockUpdateSubscription = jest.fn();
const mockGetUserSubscription = jest.fn();

jest.mock('@/lib/billing/server', () => ({
  getAuthenticatedUserId: (...args: unknown[]) => mockGetAuthenticatedUserId(...args),
  getBillingService: jest.fn(async () => ({
    createSubscription: mockCreateSubscription,
    updateSubscription: mockUpdateSubscription,
    getUserSubscription: mockGetUserSubscription,
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
