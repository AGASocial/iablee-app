import { NextResponse } from 'next/server';
import { getAuthenticatedContext } from '@/lib/auth-context';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { withTiming } from '@/lib/observability';

export interface BeneficiaryRelationship {
  holder_full_name: string;
  relationship_key: string | null;
  beneficiary_id: string;
  email_verified_at: string | null;
  created_at: string;
}

/**
 * GET /api/beneficiaries/my-relationships
 *
 * Lists account holders who have verified the current user as a beneficiary.
 * Requires auth, a configured PIN, and a security session for that user.
 * Calls a service-role-only RPC with the session email.
 */
export const GET = withTiming('GET /api/beneficiaries/my-relationships', async () => {
  const auth = await getAuthenticatedContext();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  if (!auth.ctx.hasPin || !auth.ctx.hasSecuritySession) {
    return NextResponse.json({ error: 'Security PIN required' }, { status: 403 });
  }

  const sessionEmail = auth.ctx.user.email;
  if (!sessionEmail) {
    return NextResponse.json({ error: 'User email not available' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin.rpc('get_my_beneficiary_relationships', {
    p_email: sessionEmail,
  });

  if (error) {
    console.error('Error fetching beneficiary relationships', {
      message: error.message,
      code: error.code,
    });
    return NextResponse.json(
      { error: 'Failed to fetch beneficiary relationships' },
      { status: 500 }
    );
  }

  return NextResponse.json({
    relationships: (data || []) as BeneficiaryRelationship[],
  });
});
