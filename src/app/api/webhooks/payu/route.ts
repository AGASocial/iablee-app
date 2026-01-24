/**
 * POST /api/webhooks/payu
 * PayU confirmation webhook endpoint
 */

import { NextRequest } from 'next/server';
import { getBillingService, errorResponse, successResponse } from '@/lib/billing/server';
import { PayUWebhookNormalizer } from '@/lib/billing/adapters';

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.PAYU_API_KEY;
    const merchantId = process.env.PAYU_MERCHANT_ID;

    if (!apiKey || !merchantId) {
      console.error('PayU webhook environment variables are not configured');
      return errorResponse('PayU webhook not configured', 500);
    }

    const formData = await request.formData();
    const payload: Record<string, string> = {};
    for (const [key, value] of formData.entries()) {
      if (typeof value === 'string') {
        payload[key] = value;
      }
    }

    const normalizer = new PayUWebhookNormalizer({ apiKey, merchantId });

    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      headers[key] = value;
    });

    const verification = await normalizer.verify(payload);

    if (!verification.verified || !verification.event) {
      console.error('PayU webhook verification failed:', verification.error);
      return errorResponse('Webhook verification failed', 401);
    }

    const normalizedEvent = normalizer.normalize(verification.event);

    if (!normalizedEvent) {
      console.log('PayU webhook ignored (unsupported state)');
      return successResponse({ received: true, processed: false });
    }

    const billingService = await getBillingService();
    await billingService.handleWebhookEvent(normalizedEvent);

    return successResponse({ received: true, processed: true });
  } catch (error) {
    console.error('Error processing PayU webhook:', error);
    return successResponse({
      received: true,
      processed: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
