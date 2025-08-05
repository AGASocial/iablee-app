import createMiddleware from 'next-intl/middleware';
import {routing} from './i18n/routing';
import { createMiddlewareClient } from '@supabase/auth-helpers-nextjs'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const intlMiddleware = createMiddleware(routing);

export async function middleware(req: NextRequest) {
  // First, run next-intl middleware for locale negotiation
  const intlResponse = await intlMiddleware(req);
  if (intlResponse) return intlResponse;

  // Then, run your Supabase session logic
  const res = NextResponse.next()
  const supabase = createMiddlewareClient({ req, res })

  const {
    data: { session },
  } = await supabase.auth.getSession()

  console.log("Supabase session in middleware:", session);

  // Get the locale from the URL path
  const pathname = req.nextUrl.pathname;
  const pathnameIsMissingLocale = routing.locales.every(
    (locale) => !pathname.startsWith(`/${locale}/`) && pathname !== `/${locale}`
  );

  // Get the default locale
  const defaultLocale = routing.defaultLocale;
  
  // Extract locale from pathname or use default
  let locale = defaultLocale;
  if (!pathnameIsMissingLocale) {
    const pathnameLocale = routing.locales.find(
      (locale) => pathname.startsWith(`/${locale}/`) || pathname === `/${locale}`
    );
    if (pathnameLocale) {
      locale = pathnameLocale;
    }
  }

  // If user is not signed in and the current path is not / or /auth/*,
  // redirect the user to /{locale}/auth/login
  if (!session && !pathname.startsWith(`/${locale}/auth`) && !pathname.startsWith('/auth')) {
    const redirectUrl = req.nextUrl.clone()
    redirectUrl.pathname = `/${locale}/auth/login`
    redirectUrl.searchParams.set(`redirectedFrom`, req.nextUrl.pathname)
    return NextResponse.redirect(redirectUrl)
  }

  // If user is signed in and the current path is /auth/*,
  // check if they have assets and redirect accordingly
  if (session && (pathname.startsWith(`/${locale}/auth`) || pathname.startsWith('/auth'))) {
    const redirectUrl = req.nextUrl.clone()
    
    // Check if user has any assets
    const { data: assets } = await supabase
      .from('digital_assets')
      .select('id')
      .eq('user_id', session.user.id)
      .limit(1);
    console.log("Assets in middleware:", assets);
    // If user has no assets, redirect to wizard
    if (!assets || assets.length === 0) {
      redirectUrl.pathname = `/${locale}/wizard`
    } else {
      redirectUrl.pathname = `/${locale}/dashboard`
    }
    
    return NextResponse.redirect(redirectUrl)
  }

  return res
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
} 