import { NextRequest, NextResponse } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { getAuthRedirectOrigin } from '@/lib/app-url';
import { consumeOpenPinResetGrants } from '@/lib/pin-reset-grants';
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

function readSessionUserId(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const record = data as {
    user?: { id?: string } | null;
    session?: { user?: { id?: string } } | null;
  };
  const id = record.user?.id ?? record.session?.user?.id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const tokenHash = requestUrl.searchParams.get('token_hash');
  const otpType = requestUrl.searchParams.get('type') as EmailOtpType | null;
  // Same fixed host as OAuth, signup, and recovery. Request Origin / Host are ignored.
  const origin = getAuthRedirectOrigin();
  const nextPath = sanitizeNextPath(requestUrl.searchParams.get('next'), origin);
  const locale = localeFromNextPath(nextPath);
  const supabase = await createRouteClient();

  const fail = (path: string) => {
    const errorResponse = NextResponse.redirect(new URL(path, origin));
    errorResponse.cookies.delete('auth_callback_next');
    return errorResponse;
  };

  let error: Error | null = null;
  let sessionUserId: string | null = null;
  if (code) {
    const result = await supabase.auth.exchangeCodeForSession(code);
    error = result.error;
    sessionUserId = readSessionUserId(result.data);
  } else if (tokenHash && otpType) {
    const result = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: otpType,
    });
    error = result.error;
    sessionUserId = readSessionUserId(result.data);
  } else {
    return fail(`/${locale}/auth/login?error=missing_code`);
  }

  if (error) {
    console.error('Auth callback exchange error:', error);
    return fail(`/${locale}/auth/forgot-password?error=auth_callback_failed`);
  }

  if (!sessionUserId) {
    console.error('Auth callback exchange returned no user');
    return fail(`/${locale}/auth/login?error=auth_callback_failed`);
  }

  const consumed = await consumeOpenPinResetGrants(sessionUserId);
  if (!consumed) {
    return fail(`/${locale}/auth/login?error=auth_callback_failed`);
  }

  const successResponse = NextResponse.redirect(new URL(nextPath, origin));
  successResponse.cookies.delete('auth_callback_next');
  successResponse.cookies.set(
    SECURITY_SESSION_COOKIE_NAME,
    '',
    securitySessionCookieOptions(0)
  );
  return successResponse;
}
