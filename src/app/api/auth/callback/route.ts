import { NextRequest, NextResponse } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { createRouteClient } from '@/lib/supabase-server';

function sanitizeNextPath(nextParam: string | null): string {
  if (!nextParam) return '/en';
  if (!nextParam.startsWith('/')) return '/en';
  if (nextParam.startsWith('//')) return '/en';
  return nextParam;
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const tokenHash = requestUrl.searchParams.get('token_hash');
  const otpType = requestUrl.searchParams.get('type') as EmailOtpType | null;
  const nextPath = sanitizeNextPath(requestUrl.searchParams.get('next'));
  const supabase = await createRouteClient();

  let error: Error | null = null;
  if (code) {
    const result = await supabase.auth.exchangeCodeForSession(code);
    error = result.error;
  } else if (tokenHash && otpType) {
    const result = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: otpType,
    });
    error = result.error;
  } else {
    return NextResponse.redirect(new URL('/en/auth/login?error=missing_code', request.url));
  }

  if (error) {
    console.error('Auth callback exchange error:', error);
    return NextResponse.redirect(new URL('/en/auth/login?error=auth_callback_failed', request.url));
  }

  return NextResponse.redirect(new URL(nextPath, request.url));
}
