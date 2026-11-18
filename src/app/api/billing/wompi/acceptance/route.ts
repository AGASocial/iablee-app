/**
 * GET /api/billing/wompi/acceptance
 * Returns merchant acceptance tokens + permalinks for checkboxes.
 */

import {
  getAuthenticatedUserId,
  getPaymentGateway,
  errorResponse,
  successResponse,
} from '@/lib/billing/server';
import type { WompiAdapter } from '@/lib/billing/adapters/wompi.adapter';

export async function GET() {
  try {
    const userId = await getAuthenticatedUserId();
    if (!userId) {
      return errorResponse('Unauthorized', 401);
    }

    const gateway = getPaymentGateway();
    if (gateway.getName() !== 'wompi') {
      return errorResponse('Wompi is not the active payment gateway', 400);
    }

    const wompi = gateway as WompiAdapter;
    const tokens = await wompi.getAcceptanceTokens();

    return successResponse({
      publicKey: wompi.getPublicKey(),
      environment: wompi.getEnvironment(),
      acceptanceToken: tokens.acceptanceToken,
      acceptancePermalink: tokens.acceptancePermalink,
      personalAuthToken: tokens.personalAuthToken,
      personalAuthPermalink: tokens.personalAuthPermalink,
    });
  } catch (error) {
    console.error('Wompi acceptance fetch failed:', error);
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to fetch acceptance tokens',
      500
    );
  }
}
