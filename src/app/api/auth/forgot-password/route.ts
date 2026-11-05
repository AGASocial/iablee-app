import { NextRequest, NextResponse } from 'next/server';
import { getAuthRedirectOrigin, resolveAuthLocale } from '@/lib/app-url';
import { createRouteClient } from '@/lib/supabase-server';

export async function POST(request: NextRequest) {
  try {
    const { email, locale } = await request.json();

    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(email)) {
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
    }

    const safeLocale = resolveAuthLocale(locale);
    const origin = getAuthRedirectOrigin();
    const redirectTo = `${origin}/api/auth/callback?next=${encodeURIComponent(`/${safeLocale}/auth/reset-password`)}`;

    const supabase = await createRouteClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });

    if (error) {
      console.error('Forgot password error:', error.message, { redirectTo });

      if (error.message.toLowerCase().includes('rate limit')) {
        return NextResponse.json(
          { error: 'email_rate_limit_exceeded' },
          { status: 429 }
        );
      }
    }

    const response = NextResponse.json({ success: true });
    response.cookies.set('auth_callback_next', `/${safeLocale}/auth/reset-password`, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 15,
      path: '/',
    });
    return response;
  } catch (error) {
    console.error('Forgot password error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
