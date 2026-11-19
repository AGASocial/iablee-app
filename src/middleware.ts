import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';
import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getSupabaseClientDbOption, isNonPublicSchema } from '@/lib/supabase-schema'
import {
  ensureUserProfileIfNeeded,
  PROFILE_OK_COOKIE_NAME,
  profileOkCookieOptions,
} from '@/lib/ensure-user-profile'

const intlMiddleware = createMiddleware(routing);

// function name changed to middleware for Next.js convention
export async function middleware(request: NextRequest) {
  // First, run next-intl middleware for locale negotiation
  const intlResponse = await intlMiddleware(request);

  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      db: getSupabaseClientDbOption(),
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );

          supabaseResponse = NextResponse.next({
            request,
          });

          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Test-schema only: ensure profile row once per user/session via cookie guard.
  // Production (`public`) must never call ensure_user_profile or set this cookie.
  let profileCookieUserId: string | null = null;
  if (user && isNonPublicSchema()) {
    const profileOk = request.cookies.get(PROFILE_OK_COOKIE_NAME)?.value;
    if (profileOk !== user.id) {
      const ensured = await ensureUserProfileIfNeeded(supabase);
      if (ensured) {
        profileCookieUserId = user.id;
      }
    }
  }

  const applyProfileCookie = (response: NextResponse) => {
    if (profileCookieUserId) {
      response.cookies.set(
        PROFILE_OK_COOKIE_NAME,
        profileCookieUserId,
        profileOkCookieOptions()
      );
    }
    return response;
  };

  // If user is not signed in and the current path is not /auth/*,
  // redirect the user to /{locale}/auth/login
  const pathname = request.nextUrl.pathname;

  // Get the locale from the URL path or default
  const defaultLocale = routing.defaultLocale;
  const pathnameIsMissingLocale = routing.locales.every(
    (locale) => !pathname.startsWith(`/${locale}/`) && pathname !== `/${locale}`
  );

  let locale = defaultLocale;
  if (!pathnameIsMissingLocale) {
    const pathnameLocale = routing.locales.find(
      (locale) => pathname.startsWith(`/${locale}/`) || pathname === `/${locale}`
    );
    if (pathnameLocale) {
      locale = pathnameLocale;
    }
  }

  // Supabase auth links may land on Site URL (e.g. /?code=...) instead of /api/auth/callback.
  // Forward auth params to the callback handler before any login redirect.
  const authCode = request.nextUrl.searchParams.get('code');
  const tokenHash = request.nextUrl.searchParams.get('token_hash');
  const authType = request.nextUrl.searchParams.get('type');

  if ((authCode || tokenHash) && !pathname.startsWith('/api/auth/callback')) {
    const callbackUrl = request.nextUrl.clone();
    callbackUrl.pathname = '/api/auth/callback';

    if (!callbackUrl.searchParams.get('next')) {
      const pendingNext = request.cookies.get('auth_callback_next')?.value;
      if (pendingNext?.startsWith('/')) {
        callbackUrl.searchParams.set('next', pendingNext);
      } else if (authType === 'recovery') {
        callbackUrl.searchParams.set('next', `/${locale}/auth/reset-password`);
      } else {
        callbackUrl.searchParams.set('next', `/${locale}/dashboard`);
      }
    }

    return applyProfileCookie(NextResponse.redirect(callbackUrl));
  }

  // Redirect authenticated users on locale home to wizard or dashboard
  if (user && (pathname === `/${locale}` || pathname === `/${locale}/`)) {
    const { count } = await supabase
      .from('digital_assets')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id);

    const target = count === 0 ? `/${locale}/wizard` : `/${locale}/dashboard`;
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = target;
    redirectUrl.search = '';
    return applyProfileCookie(NextResponse.redirect(redirectUrl));
  }

  // Locale home (and bare `/`) are public marketing — LandingPage for signed-out users.
  const isPublicLanding =
    pathname === '/' ||
    pathname === `/${locale}` ||
    pathname === `/${locale}/`;

  // Protected routes check
  if (
    !user &&
    !isPublicLanding &&
    !pathname.includes('/auth/') &&
    !pathname.includes('/verify-beneficiary-email')
  ) {
    // If we are on a protected route and not logged in, redirect to login
    // However, we need to respect internationalized paths.
    // The intlMiddleware handles the locale part, but if we need to redirect...

    // Check if it's a public path or asset
    if (
      !pathname.startsWith('/_next') &&
      !pathname.includes('/api/') &&
      !pathname.includes('.') // static files
    ) {
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = `/${locale}/auth/login`;
      loginUrl.searchParams.set(`redirectedFrom`, pathname);
      return applyProfileCookie(NextResponse.redirect(loginUrl));
    }
  }

  // If we have an intlResponse (redirect or rewrite), we should return it, 
  // but we need to merge the cookies set by Supabase.
  if (intlResponse) {
    // Copy cookies from supabaseResponse to intlResponse
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      intlResponse.cookies.set(cookie.name, cookie.value, cookie);
    });
    return applyProfileCookie(intlResponse);
  }

  return applyProfileCookie(supabaseResponse);
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
} 