/**
 * POST /api/webhooks/wompi
 * Wompi events webhook (transaction.updated).
 * 401 on bad signature; 200 for ignored/unsupported events;
 * 5xx after a verified event if DB processing fails (so Wompi retries).
 */

import { NextRequest } from 'next/server';
import { getBillingService, errorResponse, successResponse } from '@/lib/billing/server';
import { WompiWebhookNormalizer } from '@/lib/billing/adapters';

export async function POST(request: NextRequest) {
  try {
    const eventsSecret = process.env.WOMPI_EVENTS_SECRET;

    if (!eventsSecret) {
      console.error('Wompi webhook: WOMPI_EVENTS_SECRET is not configured');
      return errorResponse('Wompi webhook not configured', 500);
    }

    const rawBody = await request.text();
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      console.error('Wompi webhook: invalid JSON body');
      return errorResponse('Invalid JSON', 400);
    }

    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      headers[key] = value;
    });

    const normalizer = new WompiWebhookNormalizer({ eventsSecret });
    const verification = await normalizer.verify(payload as object, headers);

    if (!verification.verified || !verification.event) {
      console.error('Wompi webhook verification failed:', verification.error);
      return errorResponse('Webhook verification failed', 401);
    }

    const eventName =
      typeof verification.event === 'object' &&
      verification.event !== null &&
      'event' in verification.event
        ? String((verification.event as { event?: string }).event || '')
        : '';

    if (!normalizer.shouldProcess(eventName)) {
      console.log('Wompi webhook ignored (unsupported event type)');
      return successResponse({ received: true, processed: false });
    }

    const normalizedEvent = normalizer.normalize(verification.event);

    if (!normalizedEvent) {
      console.log('Wompi webhook ignored (unsupported or incomplete payload)');
      return successResponse({ received: true, processed: false });
    }

    try {
      const billingService = await getBillingService();
      await billingService.handleWebhookEvent(normalizedEvent);
    } catch (processingError) {
      console.error(
        'Wompi webhook processing failed after verification:',
        processingError instanceof Error ? processingError.message : 'Unknown error'
      );
      return errorResponse('Webhook processing failed', 500);
    }

    return successResponse({ received: true, processed: true });
  } catch (error) {
    console.error(
      'Error processing Wompi webhook:',
      error instanceof Error ? error.message : 'Unknown error'
    );
    return errorResponse('Webhook handler error', 500);
  }
}
