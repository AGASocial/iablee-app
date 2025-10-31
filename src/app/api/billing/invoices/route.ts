/**
 * Invoices API Routes
 * GET /api/billing/invoices - Get user's invoices
 */

import { NextRequest } from 'next/server';
import {
  getBillingService,
  getAuthenticatedUserId,
  errorResponse,
  successResponse,
} from '@/lib/billing/server';

export async function GET(request: NextRequest) {
  try {
    const userId = await getAuthenticatedUserId();
    if (!userId) {
      return errorResponse('Unauthorized', 401);
    }

    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '10', 10);

    const billingService = await getBillingService();
    const invoices = await billingService.getInvoices(userId, limit);

    return successResponse({ invoices });
  } catch (error) {
    console.error('Error fetching invoices:', error);
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to fetch invoices',
      500
    );
  }
}
