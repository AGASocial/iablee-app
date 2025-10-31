/**
 * Subscription API Routes
 * GET /api/billing/subscriptions - Get user's subscription
 * POST /api/billing/subscriptions - Create a subscription
 * PATCH /api/billing/subscriptions - Update subscription
 * DELETE /api/billing/subscriptions - Cancel subscription
 */

import { NextRequest } from 'next/server';
import {
  getBillingService,
  getAuthenticatedUserId,
  errorResponse,
  successResponse,
} from '@/lib/billing/server';
import type {
  CreateSubscriptionRequest,
  UpdateSubscriptionRequest,
  CancelSubscriptionRequest,
} from '@/lib/billing';

export async function GET() {
  try {
    const userId = await getAuthenticatedUserId();
    if (!userId) {
      return errorResponse('Unauthorized', 401);
    }

    const billingService = await getBillingService();
    const subscription = await billingService.getUserSubscription(userId);

    // If no subscription, return the Free plan
    if (!subscription) {
      const freePlan = await billingService.getPlan('plan_free');
      return successResponse({
        subscription: {
          id: 'free',
          userId,
          planId: 'plan_free',
          status: 'active',
          currentPeriodStart: new Date(),
          currentPeriodEnd: null, // Free plan never expires
          cancelAtPeriodEnd: false,
          createdAt: new Date(),
          updatedAt: new Date(),
          plan: freePlan,
        },
      });
    }

    // Fetch the plan details for paid subscription
    const plan = await billingService.getPlan(subscription.planId);

    return successResponse({
      subscription: {
        ...subscription,
        plan,
      },
    });
  } catch (error) {
    console.error('Error fetching subscription:', error);
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to fetch subscription',
      500
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = await getAuthenticatedUserId();
    if (!userId) {
      return errorResponse('Unauthorized', 401);
    }

    const body = await request.json();
    const { planId, paymentMethodToken } = body;

    if (!planId) {
      return errorResponse('Plan ID is required', 400);
    }

    const billingService = await getBillingService();

    const subscriptionRequest: CreateSubscriptionRequest = {
      userId,
      planId,
      paymentMethodToken,
    };

    const result = await billingService.createSubscription(subscriptionRequest);

    return successResponse(result, 201);
  } catch (error) {
    console.error('Error creating subscription:', error);
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to create subscription',
      500
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const userId = await getAuthenticatedUserId();
    if (!userId) {
      return errorResponse('Unauthorized', 401);
    }

    const body = await request.json();
    const { subscriptionId, planId, cancelAtPeriodEnd } = body;

    if (!subscriptionId) {
      return errorResponse('Subscription ID is required', 400);
    }

    const billingService = await getBillingService();

    // Verify user owns this subscription
    const subscription = await billingService.getUserSubscription(userId);
    if (!subscription || subscription.id !== subscriptionId) {
      return errorResponse('Subscription not found', 404);
    }

    const updateRequest: UpdateSubscriptionRequest = {
      subscriptionId,
      planId,
      cancelAtPeriodEnd,
    };

    await billingService.updateSubscription(updateRequest);

    return successResponse({ success: true });
  } catch (error) {
    console.error('Error updating subscription:', error);
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to update subscription',
      500
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const userId = await getAuthenticatedUserId();
    if (!userId) {
      return errorResponse('Unauthorized', 401);
    }

    const { searchParams } = new URL(request.url);
    const subscriptionId = searchParams.get('subscriptionId');
    const atPeriodEnd = searchParams.get('atPeriodEnd') === 'true';

    if (!subscriptionId) {
      return errorResponse('Subscription ID is required', 400);
    }

    const billingService = await getBillingService();

    // Verify user owns this subscription
    const subscription = await billingService.getUserSubscription(userId);
    if (!subscription || subscription.id !== subscriptionId) {
      return errorResponse('Subscription not found', 404);
    }

    const cancelRequest: CancelSubscriptionRequest = {
      subscriptionId,
      atPeriodEnd,
    };

    await billingService.cancelSubscription(cancelRequest);

    return successResponse({ success: true });
  } catch (error) {
    console.error('Error canceling subscription:', error);
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to cancel subscription',
      500
    );
  }
}
