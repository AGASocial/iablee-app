import { supabaseAdmin } from '@/lib/supabase-admin';

export type SecurityPinWriteResult = 'ok' | 'conflict' | 'error';

/**
 * First PIN only. Zero rows means a hash appeared after the empty check,
 * so the caller must go through the reset grant.
 */
export async function assignInitialSecurityPin(
  userId: string,
  hash: string
): Promise<SecurityPinWriteResult> {
  const { data, error } = await supabaseAdmin
    .from('users')
    .update({
      security_pin_hash: hash,
      security_pin_updated_at: new Date().toISOString(),
      pin_failed_attempts: 0,
      pin_locked_until: null,
    })
    .eq('id', userId)
    .is('security_pin_hash', null)
    .select('id');

  if (error) {
    console.error('Error assigning initial security PIN:', error);
    return 'error';
  }

  if (!data || data.length === 0) return 'conflict';
  return 'ok';
}

/** Replaces the hash that was just compared. The version trigger bumps on this UPDATE. */
export async function replaceSecurityPin(
  userId: string,
  expectedHash: string,
  hash: string
): Promise<SecurityPinWriteResult> {
  const { data, error } = await supabaseAdmin
    .from('users')
    .update({
      security_pin_hash: hash,
      security_pin_updated_at: new Date().toISOString(),
      pin_failed_attempts: 0,
      pin_locked_until: null,
    })
    .eq('id', userId)
    .eq('security_pin_hash', expectedHash)
    .select('id');

  if (error) {
    console.error('Error replacing security PIN:', error);
    return 'error';
  }

  if (!data || data.length === 0) return 'conflict';
  return 'ok';
}
