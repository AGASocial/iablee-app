import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

/**
 * Supabase SSR auth cookies use these defaults (httpOnly false, SameSite=Lax, path=/).
 * A clear must repeat them or the browser keeps the session cookie.
 */
const expiredAuthCookie = {
  path: '/',
  sameSite: 'lax' as const,
  httpOnly: false,
  maxAge: 0,
};

function isSupabaseAuthCookie(name: string): boolean {
  return name.startsWith('sb-') && name.includes('auth-token');
}

type RevocableAuthClient = {
  auth: {
    signOut: (options?: { scope?: 'local' | 'global' | 'others' }) => Promise<{
      error: { message?: string } | null;
    }>;
  };
};

/**
 * Drops the session created in this request when a follow-up step fails.
 * signOut is attempted first. Auth cookies are expired on the cookie store and
 * on this response even when the revoke call fails, so the browser is not left logged in.
 */
export async function abandonAuthenticatedSession(
  supabase: RevocableAuthClient,
  response: NextResponse
): Promise<void> {
  try {
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error) {
      console.error('Failed to revoke auth session after PIN grant consume:', error);
    }
  } catch (error) {
    console.error('Failed to revoke auth session after PIN grant consume:', error);
  }

  let names: string[] = [];
  try {
    const cookieStore = await cookies();
    const all = typeof cookieStore.getAll === 'function' ? cookieStore.getAll() : [];
    names = all.map((cookie) => cookie.name).filter(isSupabaseAuthCookie);
    for (const name of names) {
      cookieStore.set(name, '', expiredAuthCookie);
    }
  } catch (error) {
    console.error('Failed to read auth cookies after PIN grant consume:', error);
  }

  for (const name of names) {
    response.cookies.set(name, '', expiredAuthCookie);
  }
}
