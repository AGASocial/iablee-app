/**
 * POST /api/billing/wompi/subscribe
 * Create payment source from browser token + first charge.
 * Body never includes PAN/CVC — only Wompi tokens.
 */

import {
  getAuthenticatedUserId,
  getBillingService,
  getPaymentGateway,
  errorResponse,
  successResponse,
} from '@/lib/billing/server';
import type { WompiAdapter } from '@/lib/billing/adapters/wompi.adapter';
import { createWompiSourceAndSubscribe } from '@/lib/billing/wompi-subscribe';
import {
  BillingError,
  PlanNotFoundError,
  PlanNotPurchasableError,
} from '@/lib/billing/types';

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
      planId,
      paymentToken,
      paymentType = 'CARD',
      acceptanceToken,
      acceptPersonalAuth,
      brand,
      lastFour,
      expMonth,
      expYear,
      phoneLast4,
      locale,
    } = body || {};

    if (!planId || !paymentToken || !acceptanceToken || !acceptPersonalAuth) {
      return errorResponse(
        'planId, paymentToken, acceptanceToken, and acceptPersonalAuth are required',
        400
      );
    }

    if (paymentType !== 'CARD' && paymentType !== 'NEQUI') {
      return errorResponse('paymentType must be CARD or NEQUI', 400);
    }

    const billingService = await getBillingService();
    let plan;
    try {
      plan = await billingService.getPlan(planId);
      // Validates visibility / Necessary rules via createSubscription pre-check
      await billingService.createSubscription({ userId, planId });
    } catch (err) {
      if (err instanceof PlanNotPurchasableError || err instanceof PlanNotFoundError) {
        return errorResponse(err.message, 400);
      }
      const code =
        err instanceof BillingError
          ? err.code
          : err && typeof err === 'object' && 'code' in err
            ? String((err as { code: string }).code)
            : '';
      if (code !== 'WOMPI_SOURCE_REQUIRED') {
        return errorResponse(
          err instanceof Error ? err.message : 'Unable to start subscription',
          400
        );
      }
      // plan already loaded when WOMPI_SOURCE_REQUIRED is thrown after getPlan
      if (!plan) {
        plan = await billingService.getPlan(planId);
      }
    }

    const supabase = billingService.getSupabaseClient();
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('email')
      .eq('id', userId)
      .single();

    if (userError || !user?.email) {
      return errorResponse('User not found', 404);
    }

    const result = await createWompiSourceAndSubscribe(
      supabase,
      gateway as WompiAdapter,
      {
        userId,
        plan,
        email: user.email as string,
        locale: typeof locale === 'string' ? locale : null,
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

    const statusCode =
      result.transactionStatus === 'APPROVED'
        ? 201
        : result.transactionStatus === 'PENDING'
          ? 202
          : 402;

    return successResponse(result, statusCode);
  } catch (error) {
    console.error('Wompi subscribe failed:', error);
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to subscribe',
      500
    );
  }
}
