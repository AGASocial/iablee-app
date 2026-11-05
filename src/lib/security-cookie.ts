export const SECURITY_SESSION_COOKIE_NAME = 'security_session';

export const SECURITY_SESSION_MAX_AGE_SECONDS = 15 * 60;

/**
 * Attributes shared by every Set-Cookie for security_session, including the
 * clear (maxAge 0). Browsers ignore a delete that omits Secure on an HTTPS cookie.
 */
export function securitySessionCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge,
  };
}

export function clearSecuritySession(cookieStore: {
  set: (name: string, value: string, options: ReturnType<typeof securitySessionCookieOptions>) => void;
}) {
  cookieStore.set(
    SECURITY_SESSION_COOKIE_NAME,
    '',
    securitySessionCookieOptions(0)
  );
}
