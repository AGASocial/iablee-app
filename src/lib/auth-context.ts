import { createAuthenticatedRouteClient, checkSecuritySession } from '@/lib/supabase-server';
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

async function buildContext(
  supabase: SupabaseClient<Database>,
  user: User
): Promise<AuthenticatedContext> {
  const hasSecuritySession = await checkSecuritySession();

  const { data: userData } = await supabase
    .from('users')
    .select('security_pin_hash')
    .eq('id', user.id)
    .single();

  const hasPin = !!userData?.security_pin_hash;
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
 */
export async function getSecurityContext(): Promise<
  | { ok: true; ctx: AuthenticatedContext }
  | { ok: false; status: 401; error: string }
> {
  const { supabase, user } = await createAuthenticatedRouteClient();

  if (!user) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }

  const ctx = await buildContext(supabase, user);
  return { ok: true, ctx };
}

/**
 * Single-pass auth + security validation for API handlers.
 * Returns 403 when PIN is set but session is not verified.
 */
export async function getAuthenticatedContext(): Promise<
  | { ok: true; ctx: AuthenticatedContext }
  | { ok: false; status: 401 | 403; error: string }
> {
  const result = await getSecurityContext();
  if (!result.ok) return result;

  if (result.ctx.pinRequired) {
    return { ok: false, status: 403, error: 'Security PIN required' };
  }

  return result;
}
