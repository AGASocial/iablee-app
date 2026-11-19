import { isNonPublicSchema } from '@/lib/supabase-schema';

export const PROFILE_OK_COOKIE_NAME = 'iablee_profile_ok';

export function profileOkCookieOptions(maxAgeSeconds = 60 * 60 * 24 * 400) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: maxAgeSeconds,
  };
}

type RpcClient = {
  rpc: (
    fn: string
  ) => PromiseLike<{ error: { message?: string } | null }>;
};

/**
 * Upserts `<schema>.users` via SECURITY DEFINER RPC when not on `public`.
 * No-op in production (`public`) — no RPC, no side effects.
 * Errors are logged without PII and never thrown.
 * @returns true when the profile was ensured successfully (non-public only)
 */
export async function ensureUserProfileIfNeeded(
  supabase: RpcClient
): Promise<boolean> {
  if (!isNonPublicSchema()) {
    return false;
  }

  try {
    const { error } = await supabase.rpc('ensure_user_profile');
    if (error) {
      console.error(
        'ensure_user_profile failed:',
        error.message ?? 'unknown error'
      );
      return false;
    }
    return true;
  } catch (err) {
    console.error(
      'ensure_user_profile failed:',
      err instanceof Error ? err.message : 'unknown error'
    );
    return false;
  }
}
