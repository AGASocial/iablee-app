import { createAuthenticatedRouteClient, checkSecuritySession } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import type { User } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase';

export interface AuthenticatedContext {
  supabase: SupabaseClient<Database>;
  user: User;
  hasSecuritySession: boolean;
  hasPin: boolean;
  pinRequired: boolean;
}

async function userHasSecurityPin(userId: string): Promise<boolean | null> {
  const { data, error } = await supabaseAdmin.rpc('user_has_security_pin', {
    p_user_id: userId,
  });

  if (error || typeof data !== 'boolean') {
    console.error('Error reading PIN status:', error);
    return null;
  }

  return data;
}

async function buildContext(
  supabase: SupabaseClient<Database>,
  user: User
): Promise<AuthenticatedContext | { unavailable: true }> {
  const hasSecuritySession = await checkSecuritySession(user.id);
  const hasPin = await userHasSecurityPin(user.id);

  // A missing row or a failed read is not "this user has no PIN".
  if (hasPin === null) {
    return { unavailable: true };
  }

  const pinRequired = hasPin && !hasSecuritySession;

  return {
    supabase,
    user,
    hasSecuritySession,
    hasPin,
    pinRequired,
  };
}

/**
 * Read auth + security state without blocking on PIN.
 * Used by check-session and security UI.
 * PIN presence is a boolean from the service client. The hash is never selected.
 */
export async function getSecurityContext(): Promise<
  | { ok: true; ctx: AuthenticatedContext }
  | { ok: false; status: 401 | 503; error: string }
> {
  const { supabase, user } = await createAuthenticatedRouteClient();

  if (!user) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }

  const ctx = await buildContext(supabase, user);
  if ('unavailable' in ctx) {
    return { ok: false, status: 503, error: 'Security status unavailable' };
  }

  return { ok: true, ctx };
}

/**
 * Single-pass auth + security validation for API handlers.
 * Returns 403 when PIN is set but session is not verified.
 */
export async function getAuthenticatedContext(): Promise<
  | { ok: true; ctx: AuthenticatedContext }
  | { ok: false; status: 401 | 403 | 503; error: string }
> {
  const result = await getSecurityContext();
  if (!result.ok) return result;

  if (result.ctx.pinRequired) {
    return { ok: false, status: 403, error: 'Security PIN required' };
  }

  return result;
}
