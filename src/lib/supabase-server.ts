import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database } from '@/lib/supabase';
import { supabaseAdmin } from '@/lib/supabase-admin';
import {
  readSecuritySession,
  type SecuritySessionPurpose,
} from '@/lib/security';
import { SECURITY_SESSION_COOKIE_NAME } from '@/lib/security-cookie';

/**
 * Creates an authenticated Supabase server client for use in API routes.
 * Eliminates the repeated boilerplate of setting up cookie handling.
 */
export async function createRouteClient() {
    const cookieStore = await cookies();

    return createServerClient<Database>(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll() {
                    return cookieStore.getAll();
                },
                setAll(cookiesToSet) {
                    try {
                        cookiesToSet.forEach(({ name, value, options }) =>
                            cookieStore.set(name, value, options)
                        );
                    } catch {
                        // The `setAll` method was called from a Server Component.
                        // This can be ignored if you have middleware refreshing
                        // user sessions.
                    }
                },
            },
        }
    );
}

/**
 * Creates an authenticated Supabase server client and validates the user.
 * Returns { supabase, user } or throws if not authenticated.
 * Use this when you need to guarantee the user is authenticated.
 */
export async function createAuthenticatedRouteClient() {
    const supabase = await createRouteClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return { supabase, user: null } as const;
    }

    return { supabase, user } as const;
}

async function loadSecurityPinVersion(userId: string): Promise<number | null> {
    const { data, error } = await supabaseAdmin
        .from('users')
        .select('security_pin_version')
        .eq('id', userId)
        .maybeSingle();

    if (error || !data) return null;
    const version = data.security_pin_version;
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 0) {
        return null;
    }
    return version;
}

async function securityCookieMatchesPinVersion(
    userId: string,
    purpose: SecuritySessionPurpose
): Promise<boolean> {
    const cookieStore = await cookies();
    const securitySession = cookieStore.get(SECURITY_SESSION_COOKIE_NAME);
    if (!securitySession?.value) return false;

    const session = await readSecuritySession(securitySession.value, userId, purpose);
    if (!session || session.pinVersion === null) return false;

    const current = await loadSecurityPinVersion(userId);
    return current === session.pinVersion;
}

/**
 * Checks if this authenticated user has a valid security session (PIN verified).
 * Rejects tokens minted for a different user or an older PIN version.
 */
export async function checkSecuritySession(userId: string) {
    if (!userId) return false;
    return securityCookieMatchesPinVersion(userId, 'pin_verified');
}

/**
 * True only for a security_session minted by the PIN-reset OTP, not by verify-pin.
 */
export async function hasPinResetSession(userId: string) {
    if (!userId) return false;
    return securityCookieMatchesPinVersion(userId, 'pin_reset');
}

/**
 * Grant id from a pin_reset cookie. Missing, reused, or verify-pin cookies return null.
 * A cookie issued before the current PIN version is rejected.
 */
export async function readPinResetGrant(userId: string): Promise<string | null> {
    if (!userId) return null;

    const cookieStore = await cookies();
    const securitySession = cookieStore.get(SECURITY_SESSION_COOKIE_NAME);
    if (!securitySession?.value) return null;

    const session = await readSecuritySession(securitySession.value, userId, 'pin_reset');
    if (!session?.jti || session.pinVersion === null) return null;

    const current = await loadSecurityPinVersion(userId);
    if (current !== session.pinVersion) return null;
    return session.jti;
}
