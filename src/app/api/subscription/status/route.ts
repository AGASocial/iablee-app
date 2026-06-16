/**
 * Subscription Status API Route
 * GET /api/subscription/status - Get user's subscription status and limits
 */

import { createAuthenticatedRouteClient } from '@/lib/supabase-server';
import { getSubscriptionStatus } from '@/lib/subscription/limits';

export async function GET() {
  try {
    const { supabase, user } = await createAuthenticatedRouteClient();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const status = await getSubscriptionStatus(supabase, user.id);
    return Response.json(status);
  } catch (error) {
    console.error('Error fetching subscription status:', error);
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch subscription status' },
      { status: 500 }
    );
  }
}
