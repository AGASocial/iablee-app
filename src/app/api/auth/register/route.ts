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
    const { email, password, fullName, locale } = await request.json();

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
    }

    const safeLocale = typeof locale === 'string' && locale ? locale : 'en';
    const origin = getAppOrigin(request);
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
