import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedRouteClient } from '@/lib/supabase-server';

export async function POST(request: NextRequest) {
  try {
    const { password } = await request.json();

    if (!password || typeof password !== 'string') {
      return NextResponse.json({ error: 'Password is required' }, { status: 400 });
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters' },
        { status: 400 }
      );
    }

    if (password.length > 100) {
      return NextResponse.json(
        { error: 'Password must be less than 100 characters' },
        { status: 400 }
      );
    }

    const { supabase, user } = await createAuthenticatedRouteClient();

    if (!user) {
      return NextResponse.json({ error: 'Invalid or expired reset link' }, { status: 401 });
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
