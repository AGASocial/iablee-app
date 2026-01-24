/**
 * GET /api/billing/plans
 * Get all available billing plans
 */

import { createClient } from '@supabase/supabase-js';
import { errorResponse, successResponse } from '@/lib/billing/server';

export async function GET() {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      return errorResponse('Server configuration error', 500);
    }

    // Create Supabase client to fetch plans
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

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

    return successResponse({ plans: transformedPlans || [] });
  } catch (error) {
    console.error('Error fetching plans:', error);
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to fetch plans',
      500
    );
  }
}
