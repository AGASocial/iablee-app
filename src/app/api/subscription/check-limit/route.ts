/**
 * Check Limit API Route
 * GET /api/subscription/check-limit?type=asset|beneficiary
 */

import { createAuthenticatedRouteClient } from '@/lib/supabase-server';
import { canCreateAsset, canCreateBeneficiary } from '@/lib/subscription/limits';
import { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const { supabase, user } = await createAuthenticatedRouteClient();

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
