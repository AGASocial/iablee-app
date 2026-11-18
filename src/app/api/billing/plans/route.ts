/**
 * GET /api/billing/plans
 * Get visible billing plans (is_visible=true). Hidden plans (e.g. Necessary) stay
 * in the DB for existing subscribers but are not returned here (KAN-164).
 */

import { errorResponse, successResponse, getBillingService } from '@/lib/billing/server';

export async function GET() {
  try {
    const billingService = await getBillingService();
    const supabase = billingService.getSupabaseClient();

    const { data: plans, error } = await supabase
      .from('billing_plans')
      .select('*')
      .eq('is_visible', true)
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
      isVisible: plan.is_visible !== false,
    }));

    return successResponse(
      {
        plans: transformedPlans || [],
        // Active server gateway — UI should prefer this over NEXT_PUBLIC_PAYMENT_GATEWAY
        // so COP formatting matches the real checkout provider (KAN-164).
        provider: billingService.getProviderName(),
      },
      200,
      {
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
      }
    );
  } catch (error) {
    console.error('Error fetching plans:', error);
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to fetch plans',
      500
    );
  }
}
