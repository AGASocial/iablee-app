import { NextRequest, NextResponse } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { createRouteClient } from '@/lib/supabase-server';
import {
  SECURITY_SESSION_COOKIE_NAME,
  securitySessionCookieOptions,
} from '@/lib/security-cookie';

const FALLBACK_NEXT_PATH = '/en';

function hasForbiddenRedirectMarker(value: string): boolean {
  let current = value;
  for (let i = 0; i < 3; i += 1) {
    if (current.includes('\\') || current.includes('@') || /%5c|%40/i.test(current)) {
      return true;
    }
    try {
      const decoded = decodeURIComponent(current);
      if (decoded === current) return false;
      current = decoded;
    } catch {
      return true;
    }
  }
  return current.includes('\\') || current.includes('@');
}

export function sanitizeNextPath(nextParam: string | null, origin: string): string {
  if (!nextParam || hasForbiddenRedirectMarker(nextParam)) return FALLBACK_NEXT_PATH;

  let resolved: URL;
  let base: URL;
  try {
    resolved = new URL(nextParam, origin);
    base = new URL(origin);
  } catch {
    return FALLBACK_NEXT_PATH;
  }

  if (resolved.origin !== base.origin || resolved.host !== base.host) return FALLBACK_NEXT_PATH;
  if (resolved.protocol !== base.protocol) return FALLBACK_NEXT_PATH;
  if (resolved.username || resolved.password) return FALLBACK_NEXT_PATH;

  const path = `${resolved.pathname}${resolved.search}${resolved.hash}`;
  if (!path.startsWith('/') || path.startsWith('//')) return FALLBACK_NEXT_PATH;
  if (hasForbiddenRedirectMarker(path) || hasForbiddenRedirectMarker(resolved.href)) {
    return FALLBACK_NEXT_PATH;
  }
  return path;
}

function localeFromNextPath(nextPath: string): string {
  const match = nextPath.match(/^\/(en|es)(\/|$)/);
  return match?.[1] ?? 'es';
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const tokenHash = requestUrl.searchParams.get('token_hash');
  const otpType = requestUrl.searchParams.get('type') as EmailOtpType | null;
  const nextPath = sanitizeNextPath(requestUrl.searchParams.get('next'), requestUrl.origin);
  const locale = localeFromNextPath(nextPath);
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
    return NextResponse.redirect(
      new URL(`/${locale}/auth/login?error=missing_code`, request.url)
    );
  }

  if (error) {
    console.error('Auth callback exchange error:', error);
    const errorResponse = NextResponse.redirect(
      new URL(`/${locale}/auth/forgot-password?error=auth_callback_failed`, request.url)
    );
    errorResponse.cookies.delete('auth_callback_next');
    return errorResponse;
  }

  const successResponse = NextResponse.redirect(new URL(nextPath, request.url));
  successResponse.cookies.delete('auth_callback_next');
  successResponse.cookies.set(
    SECURITY_SESSION_COOKIE_NAME,
    '',
    securitySessionCookieOptions(0)
  );
  return successResponse;
}
