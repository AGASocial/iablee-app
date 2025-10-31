/**
 * Subscription Status API Route
 * GET /api/subscription/status - Get user's subscription status and limits
 */

import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { getSubscriptionStatus } from '@/lib/subscription/limits';

export async function GET() {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      return Response.json({ error: 'Server configuration error' }, { status: 500 });
    }

    // Get auth token from cookies
    const cookieStore = await cookies();
    const authToken =
      cookieStore.get('sb-access-token')?.value ||
      cookieStore.get('sb-' + supabaseUrl.split('//')[1]?.split('.')[0] + '-auth-token')?.value;

    if (!authToken) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Create service role client and verify token
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const {
      data: { user },
    } = await supabase.auth.getUser(authToken);

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get subscription status
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
