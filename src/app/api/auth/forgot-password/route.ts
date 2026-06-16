import { NextRequest, NextResponse } from 'next/server';
import { createRouteClient } from '@/lib/supabase-server';

function getAppOrigin(request: NextRequest): string {
  const origin = request.headers.get('origin');
  if (origin) return origin;

  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  const proto = request.headers.get('x-forwarded-proto') ?? 'https';

  if (!host) {
    throw new Error('Cannot resolve host for auth redirect');
  }

  return `${proto}://${host}`;
}

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

    const safeLocale = typeof locale === 'string' && locale ? locale : 'en';
    const origin = getAppOrigin(request);
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
