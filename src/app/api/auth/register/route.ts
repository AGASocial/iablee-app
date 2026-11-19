import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getAuthRedirectOrigin, resolveAuthLocale } from '@/lib/app-url';
import { createRouteClient } from '@/lib/supabase-server';
import { checkRateLimit, getClientIp, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { getPasswordPolicyError } from '@/lib/password-policy';
import {
  ensureUserProfileIfNeeded,
  PROFILE_OK_COOKIE_NAME,
  profileOkCookieOptions,
} from '@/lib/ensure-user-profile';

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

    const policyError = getPasswordPolicyError(
      typeof password === 'string' ? password : '',
      { email: typeof email === 'string' ? email : undefined },
    );
    if (policyError) {
      return NextResponse.json({ error: policyError }, { status: 400 });
    }

    const safeLocale = resolveAuthLocale(locale);
    const origin = getAuthRedirectOrigin();
    const emailRedirectTo = `${origin}/api/auth/callback?next=${encodeURIComponent(`/${safeLocale}`)}`;

    const supabase = await createRouteClient();
    const { data, error } = await supabase.auth.signUp({
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

    // Only when a session is returned (e.g. email confirm disabled).
    const sessionUserId = data?.session?.user?.id;
    if (sessionUserId) {
      const ensured = await ensureUserProfileIfNeeded(supabase);
      if (ensured) {
        const cookieStore = await cookies();
        cookieStore.set(
          PROFILE_OK_COOKIE_NAME,
          sessionUserId,
          profileOkCookieOptions()
        );
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Register error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
