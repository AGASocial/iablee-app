/**
 * POST /api/billing/wompi/payment-sources
 * Replace default Wompi payment method from a browser token.
 * If subscription is past_due, attempts an immediate charge.
 */

import {
  getAuthenticatedUserId,
  getBillingService,
  getPaymentGateway,
  errorResponse,
  successResponse,
} from '@/lib/billing/server';
import type { WompiAdapter } from '@/lib/billing/adapters/wompi.adapter';
import { replaceWompiPaymentMethod } from '@/lib/billing/wompi-subscribe';

export async function POST(request: Request) {
  try {
    const userId = await getAuthenticatedUserId();
    if (!userId) {
      return errorResponse('Unauthorized', 401);
    }

    const gateway = getPaymentGateway();
    if (gateway.getName() !== 'wompi') {
      return errorResponse('Wompi is not the active payment gateway', 400);
    }

    const body = await request.json();
    const {
      paymentToken,
      paymentType = 'CARD',
      acceptanceToken,
      acceptPersonalAuth,
      brand,
      lastFour,
      expMonth,
      expYear,
      phoneLast4,
    } = body || {};

    if (!paymentToken || !acceptanceToken || !acceptPersonalAuth) {
      return errorResponse(
        'paymentToken, acceptanceToken, and acceptPersonalAuth are required',
        400
      );
    }

    if (paymentType !== 'CARD' && paymentType !== 'NEQUI') {
      return errorResponse('paymentType must be CARD or NEQUI', 400);
    }

    const billingService = await getBillingService();
    const supabase = billingService.getSupabaseClient();
    const { data: user } = await supabase
      .from('users')
      .select('email')
      .eq('id', userId)
      .single();

    if (!user?.email) {
      return errorResponse('User not found', 404);
    }

    const result = await replaceWompiPaymentMethod(
      supabase,
      gateway as WompiAdapter,
      {
        userId,
        email: user.email as string,
        paymentType,
        paymentToken,
        acceptanceToken,
        acceptPersonalAuth,
        tokenMeta: {
          brand,
          lastFour,
          expMonth: expMonth != null ? Number(expMonth) : undefined,
          expYear: expYear != null ? Number(expYear) : undefined,
          phoneLast4,
        },
      }
    );

    return successResponse(result, 201);
  } catch (error) {
    console.error('Wompi payment source replace failed:', error);
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to replace payment method',
      500
    );
  }
}
