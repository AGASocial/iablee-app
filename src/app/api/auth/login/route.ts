import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createRouteClient } from '@/lib/supabase-server';
import { clearSecuritySession } from '@/lib/security-cookie';
import { consumeOpenPinResetGrants } from '@/lib/pin-reset-grants';
import { checkRateLimit, getClientIp, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';

export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request);
    const rateLimit = checkRateLimit(`auth:login:${ip}`, RATE_LIMITS.auth);
    if (!rateLimit.allowed) {
      return rateLimitResponse(rateLimit.resetAt);
    }

    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
    }

    const supabase = await createRouteClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }

    if (!data?.user?.id) {
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }

    const consumed = await consumeOpenPinResetGrants(data.user.id);
    const cookieStore = await cookies();
    clearSecuritySession(cookieStore);
    if (!consumed) {
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
