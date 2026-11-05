import { NextRequest, NextResponse } from 'next/server';
import { getAuthRedirectOrigin, resolveAuthLocale } from '@/lib/app-url';
import { createRouteClient } from '@/lib/supabase-server';

type Provider = 'google' | 'apple';

function isProvider(value: unknown): value is Provider {
  return value === 'google' || value === 'apple';
}

export async function POST(request: NextRequest) {
  try {
    const { provider, locale } = await request.json();

    if (!isProvider(provider)) {
      return NextResponse.json({ error: 'Unsupported provider' }, { status: 400 });
    }

    const safeLocale = resolveAuthLocale(locale);
    const origin = getAuthRedirectOrigin();
    const redirectTo = `${origin}/api/auth/callback?next=${encodeURIComponent(`/${safeLocale}`)}`;

    const supabase = await createRouteClient();
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo,
      },
    });

    if (error || !data.url) {
      return NextResponse.json({ error: error?.message ?? 'Failed to start OAuth flow' }, { status: 400 });
    }

    return NextResponse.json({ url: data.url });
  } catch (error) {
    console.error('OAuth start error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
