import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedRouteClient } from '@/lib/supabase-server';
import { getPasswordPolicyError } from '@/lib/password-policy';

export async function POST(request: NextRequest) {
  try {
    const { password } = await request.json();

    if (!password || typeof password !== 'string') {
      return NextResponse.json({ error: 'Password is required' }, { status: 400 });
    }

    const { supabase, user } = await createAuthenticatedRouteClient();

    if (!user) {
      return NextResponse.json({ error: 'Invalid or expired reset link' }, { status: 401 });
    }

    const policyError = getPasswordPolicyError(password, { email: user.email });
    if (policyError) {
      return NextResponse.json({ error: policyError }, { status: 400 });
    }

    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      console.error('Reset password error:', error);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Reset password error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
