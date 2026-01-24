/**
 * POST /api/webhooks/stripe
 * Stripe webhook endpoint for receiving billing events
 */

import { NextRequest } from 'next/server';
import { getBillingService, errorResponse, successResponse } from '@/lib/billing/server';
import { StripeWebhookNormalizer } from '@/lib/billing/adapters';

export async function POST(request: NextRequest) {
  try {
    // Get webhook secret from environment
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.error('STRIPE_WEBHOOK_SECRET is not configured');
      return errorResponse('Webhook secret not configured', 500);
    }

    // Get raw body for signature verification
    const body = await request.text();
    const signature = request.headers.get('stripe-signature');

    if (!signature) {
      return errorResponse('Missing stripe-signature header', 400);
    }

    // Initialize webhook normalizer
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) {
      return errorResponse('Stripe secret key not configured', 500);
    }

    const normalizer = new StripeWebhookNormalizer(stripeSecretKey);

    // Verify webhook signature
    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      headers[key] = value;
    });

    const verification = await normalizer.verify(body, headers, webhookSecret);

    if (!verification.verified) {
      console.error('Webhook verification failed:', verification.error);
      return errorResponse('Webhook verification failed', 401);
    }

    // Normalize the event
    const normalizedEvent = normalizer.normalize(verification.event);

    if (!normalizedEvent) {
      console.log('Event type not supported or failed to normalize');
      return successResponse({ received: true, processed: false });
    }

    // Check for duplicate events (idempotency)
    const eventId = normalizer.getEventId(verification.event);
    if (eventId) {
      // The BillingService will handle storing events with unique constraints
      // So duplicate events will be caught there
    }

    // Process the event
    const billingService = await getBillingService();
    await billingService.handleWebhookEvent(normalizedEvent);

    console.log(`Processed webhook event: ${normalizedEvent.type} (${normalizedEvent.id})`);

    return successResponse({ received: true, processed: true });
  } catch (error) {
    console.error('Error processing webhook:', error);

    // Return 200 to acknowledge receipt even if processing failed
    // This prevents Stripe from retrying the webhook
    // Log the error for investigation
    return successResponse({
      received: true,
      processed: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

// Disable body parsing for webhook signature verification
export const config = {
  api: {
    bodyParser: false,
  },
};
