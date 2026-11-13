/**
 * GET /api/payments/wompi/transaction?id=...
 * Server-side transaction status lookup for the return page (informational only).
 * Requires an authenticated session and ownership of the Wompi reference.
 * Does NOT activate subscriptions — webhooks are the source of truth.
 */

import { NextRequest } from 'next/server';
import { WompiAdapter, parseWompiReference } from '@/lib/billing/adapters';
import {
  errorResponse,
  getAuthenticatedUserId,
  successResponse,
} from '@/lib/billing/server';

export async function GET(request: NextRequest) {
  try {
    const userId = await getAuthenticatedUserId();
    if (!userId) {
      return errorResponse('Unauthorized', 401);
    }

    const transactionId = request.nextUrl.searchParams.get('id')?.trim();
    if (!transactionId) {
      return errorResponse('Missing transaction id', 400);
    }

    const publicKey = process.env.WOMPI_PUBLIC_KEY;
    const privateKey = process.env.WOMPI_PRIVATE_KEY;
    const integritySecret = process.env.WOMPI_INTEGRITY_SECRET;
    const redirectUrl =
      process.env.WOMPI_REDIRECT_URL ||
      'http://localhost:3000/es/payments/wompi/return';

    if (!publicKey || !privateKey || !integritySecret) {
      return errorResponse('Wompi is not configured', 500);
    }

    const adapter = new WompiAdapter({
      publicKey,
      privateKey,
      integritySecret,
      redirectUrl,
      environment: (process.env.WOMPI_ENV as 'sandbox' | 'production') || 'sandbox',
    });

    const transaction = await adapter.getTransaction(transactionId);
    const parsed = parseWompiReference(transaction.reference || '');

    if (!parsed) {
      return errorResponse('Transaction not found', 404);
    }

    if (parsed.userId !== userId) {
      return errorResponse('Forbidden', 403);
    }

    return successResponse({
      id: transaction.id,
      status: transaction.status,
      reference: transaction.reference,
      amountInCents: transaction.amountInCents,
      currency: transaction.currency,
    });
  } catch (error) {
    console.error(
      'Wompi transaction lookup failed:',
      error instanceof Error ? error.message : 'Unknown error'
    );
    return errorResponse('Failed to look up transaction', 502);
  }
}
