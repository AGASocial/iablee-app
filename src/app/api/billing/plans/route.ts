/**
 * GET /api/billing/plans
 * Get all available billing plans
 */

import { errorResponse, successResponse, getBillingService } from '@/lib/billing/server';

export async function GET() {
  try {
    const billingService = await getBillingService();
    const supabase = billingService.getSupabaseClient();

    const { data: plans, error } = await supabase
      .from('billing_plans')
      .select('*')
      .order('amount_cents', { ascending: true });

    if (error) {
      throw new Error(`Failed to fetch plans: ${error.message}`);
    }

    // Transform to match expected format
    const transformedPlans = plans?.map((plan) => ({
      id: plan.id,
      name: plan.name,
      currency: plan.currency,
      amountCents: plan.amount_cents,
      interval: plan.interval,
      features: plan.features,
      providerPriceMap: plan.provider_price_map,
    }));

    return successResponse({ plans: transformedPlans || [] }, 200, {
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    });
  } catch (error) {
    console.error('Error fetching plans:', error);
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to fetch plans',
      500
    );
  }
}
