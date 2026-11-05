import { NextRequest, NextResponse } from 'next/server';
import { getAuthRedirectOrigin, resolveAuthLocale } from '@/lib/app-url';
import { createRouteClient } from '@/lib/supabase-server';
import { checkRateLimit, getClientIp, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';

export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request);
    const rateLimit = checkRateLimit(`auth:register:${ip}`, RATE_LIMITS.auth);
    if (!rateLimit.allowed) {
      return rateLimitResponse(rateLimit.resetAt);
    }

    const { email, password, fullName, locale } = await request.json();

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
    }

    const safeLocale = resolveAuthLocale(locale);
    const origin = getAuthRedirectOrigin();
    const emailRedirectTo = `${origin}/api/auth/callback?next=${encodeURIComponent(`/${safeLocale}`)}`;

    const supabase = await createRouteClient();
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName ?? '',
        },
        emailRedirectTo,
      },
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Register error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
