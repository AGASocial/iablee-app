/**
 * Payment Methods API Routes
 * GET /api/billing/payment-methods - Get user's payment methods
 * POST /api/billing/payment-methods - Add a payment method
 * PATCH /api/billing/payment-methods - Set default payment method
 * DELETE /api/billing/payment-methods?paymentMethodId=xxx - Remove a payment method
 */

import { NextRequest } from 'next/server';
import {
  getBillingService,
  getAuthenticatedUserId,
  errorResponse,
  successResponse,
} from '@/lib/billing/server';
import type { AttachPaymentMethodRequest } from '@/lib/billing';

export async function GET() {
  try {
    const userId = await getAuthenticatedUserId();
    if (!userId) {
      return errorResponse('Unauthorized', 401);
    }

    const billingService = await getBillingService();
    const paymentMethods = await billingService.getPaymentMethods(userId);

    return successResponse({ paymentMethods });
  } catch (error) {
    console.error('Error fetching payment methods:', error);
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to fetch payment methods',
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
    const { paymentMethodId, setAsDefault = true } = body;

    if (!paymentMethodId) {
      return errorResponse('Payment method ID is required', 400);
    }

    const billingService = await getBillingService();

    const attachRequest: AttachPaymentMethodRequest = {
      userId,
      paymentMethodToken: paymentMethodId,
      setAsDefault,
    };

    const result = await billingService.attachPaymentMethod(attachRequest);

    return successResponse(result, 201);
  } catch (error) {
    console.error('Error attaching payment method:', error);
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to attach payment method',
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
    const { paymentMethodId } = body;

    if (!paymentMethodId) {
      return errorResponse('Payment method ID is required', 400);
    }

    const billingService = await getBillingService();
    await billingService.setDefaultPaymentMethod(userId, paymentMethodId);

    return successResponse({ success: true });
  } catch (error) {
    console.error('Error setting default payment method:', error);
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to set default payment method',
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
    const paymentMethodId = searchParams.get('paymentMethodId');

    if (!paymentMethodId) {
      return errorResponse('Payment method ID is required', 400);
    }

    const billingService = await getBillingService();
    await billingService.detachPaymentMethod(userId, paymentMethodId);

    return successResponse({ success: true });
  } catch (error) {
    console.error('Error deleting payment method:', error);
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to delete payment method',
      500
    );
  }
}
