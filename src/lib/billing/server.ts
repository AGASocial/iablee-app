/**
 * Server-side billing utilities
 * Helpers for initializing billing service and checking auth
 */

import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { BillingService } from './billing.service';
import { StripeAdapter, PayUAdapter } from './adapters';
import type { PaymentGateway } from './gateway.interface';

/**
 * Get the configured payment gateway based on environment
 */
export function getPaymentGateway(): PaymentGateway {
  const gateway = process.env.PAYMENT_GATEWAY || 'stripe';

  switch (gateway) {
    case 'stripe': {
      const secretKey = process.env.STRIPE_SECRET_KEY;
      if (!secretKey) {
        throw new Error('STRIPE_SECRET_KEY environment variable is required');
      }
      return new StripeAdapter(secretKey);
    }
    case 'payu': {
      const apiKey = process.env.PAYU_API_KEY;
      const apiLogin = process.env.PAYU_API_LOGIN;
      const merchantId = process.env.PAYU_MERCHANT_ID;
      const accountId = process.env.PAYU_ACCOUNT_ID;
      const paymentUrl = process.env.PAYU_PAYMENT_URL;
      const responseUrl = process.env.PAYU_RESPONSE_URL;
      const confirmationUrl = process.env.PAYU_CONFIRMATION_URL;

      if (!apiKey || !apiLogin || !merchantId || !accountId || !paymentUrl || !responseUrl || !confirmationUrl) {
        throw new Error('PayU environment variables are required when PAYMENT_GATEWAY=payu');
      }

      return new PayUAdapter({
        apiKey,
        apiLogin,
        merchantId,
        accountId,
        paymentUrl,
        responseUrl,
        confirmationUrl,
        environment: (process.env.PAYU_ENV as 'sandbox' | 'production') || 'sandbox',
        language: process.env.PAYU_LANGUAGE || 'es',
      });
    }
    default:
      throw new Error(`Unsupported payment gateway: ${gateway}`);
  }
}

/**
 * Initialize the billing service with Supabase client and payment gateway
 */
export async function getBillingService(): Promise<BillingService> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Supabase configuration is missing');
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const gateway = getPaymentGateway();

  return new BillingService(supabase, gateway);
}

/**
 * Get authenticated user ID from session
 * Returns null if not authenticated
 */
export async function getAuthenticatedUserId(): Promise<string | null> {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('Missing Supabase environment variables');
      return null;
    }

    // Get auth token from cookies
    const cookieStore = await cookies();
    const cookieName = 'sb-' + supabaseUrl.split('//')[1]?.split('.')[0] + '-auth-token';

    let authToken =
      cookieStore.get('sb-access-token')?.value ||
      cookieStore.get(cookieName)?.value;

    // If the token is JSON-encoded (array), parse it
    if (authToken && authToken.startsWith('[')) {
      try {
        const parsed = JSON.parse(authToken);
        if (Array.isArray(parsed) && parsed.length > 0) {
          authToken = parsed[0]; // Take the first element
        }
      } catch (e) {
        console.error('Failed to parse auth token:', e);
      }
    }

    if (!authToken) {
      return null;
    }

    // Create service role client and verify token
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(authToken);

    if (error) {
      console.error('Error verifying auth token:', error);
      return null;
    }

    return user?.id || null;
  } catch (error) {
    console.error('Error getting authenticated user:', error);
    return null;
  }
}

/**
 * Create error response
 */
export function errorResponse(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

/**
 * Create success response
 */
export function successResponse(data: unknown, status = 200) {
  return Response.json(data, { status });
}
