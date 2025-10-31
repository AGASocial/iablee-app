/**
 * Check Limit API Route
 * GET /api/subscription/check-limit?type=asset|beneficiary
 */

import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { canCreateAsset, canCreateBeneficiary } from '@/lib/subscription/limits';
import { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      return Response.json({ error: 'Server configuration error' }, { status: 500 });
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

    // Get type from query params
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type');

    if (!type || !['asset', 'beneficiary'].includes(type)) {
      return Response.json({ error: 'Invalid type parameter' }, { status: 400 });
    }

    // Check limit based on type
    let result;
    if (type === 'asset') {
      result = await canCreateAsset(supabase, user.id);
    } else {
      result = await canCreateBeneficiary(supabase, user.id);
    }

    return Response.json(result);
  } catch (error) {
    console.error('Error checking limit:', error);
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to check limit' },
      { status: 500 }
    );
  }
}
