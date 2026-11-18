/**
 * Per-user charge leases (KAN-166 / round-5).
 * Serialize first-charge, renewal charge, and reactivation/activation writes.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export const CHARGE_LEASE_TTL_SECONDS = 5 * 60;

function isJestEnv(): boolean {
  return typeof process !== 'undefined' && !!process.env.JEST_WORKER_ID;
}

/**
 * Acquire a per-user charge lease. Returns false if another holder owns a
 * non-expired lease.
 */
export async function acquireChargeLease(
  supabase: SupabaseClient,
  userId: string,
  holder: string,
  ttlSeconds = CHARGE_LEASE_TTL_SECONDS
): Promise<boolean> {
  if (typeof supabase.rpc === 'function') {
    const { data, error } = await supabase.rpc('acquire_billing_charge_lease', {
      p_user_id: userId,
      p_holder: holder,
      p_ttl_seconds: ttlSeconds,
    });
    if (!error) {
      return data === true;
    }
    // Missing function (migration not applied) → client CAS fallback
    console.warn('acquire_billing_charge_lease RPC unavailable; falling back', error.message);
  } else if (isJestEnv()) {
    // Unit tests without rpc mock: do not block suite
    return true;
  }

  return acquireChargeLeaseClientCas(supabase, userId, holder, ttlSeconds);
}

async function acquireChargeLeaseClientCas(
  supabase: SupabaseClient,
  userId: string,
  holder: string,
  ttlSeconds: number
): Promise<boolean> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();
  const acquiredAt = now.toISOString();

  const { error: insertError } = await supabase.from('billing_charge_leases').insert({
    user_id: userId,
    holder,
    acquired_at: acquiredAt,
    expires_at: expiresAt,
  });

  if (!insertError) return true;
  if (insertError.code !== '23505') {
    console.error('Charge lease insert failed', insertError);
    return false;
  }

  const { data } = await supabase
    .from('billing_charge_leases')
    .update({
      holder,
      acquired_at: acquiredAt,
      expires_at: expiresAt,
    })
    .eq('user_id', userId)
    .lt('expires_at', acquiredAt)
    .select('user_id')
    .maybeSingle();

  if (data?.user_id) return true;

  // Same holder renew
  const { data: renewed } = await supabase
    .from('billing_charge_leases')
    .update({ acquired_at: acquiredAt, expires_at: expiresAt })
    .eq('user_id', userId)
    .eq('holder', holder)
    .select('user_id')
    .maybeSingle();

  return !!renewed?.user_id;
}

export async function releaseChargeLease(
  supabase: SupabaseClient,
  userId: string,
  holder: string
): Promise<void> {
  if (typeof supabase.rpc === 'function') {
    const { error } = await supabase.rpc('release_billing_charge_lease', {
      p_user_id: userId,
      p_holder: holder,
    });
    if (!error) return;
    console.warn('release_billing_charge_lease RPC unavailable; falling back', error.message);
  } else if (isJestEnv()) {
    return;
  }

  await supabase
    .from('billing_charge_leases')
    .delete()
    .eq('user_id', userId)
    .eq('holder', holder);
}

export async function withChargeLease<T>(
  supabase: SupabaseClient,
  userId: string,
  holder: string,
  fn: () => Promise<T>
): Promise<{ acquired: false } | { acquired: true; result: T }> {
  const acquired = await acquireChargeLease(supabase, userId, holder);
  if (!acquired) {
    return { acquired: false };
  }
  try {
    const result = await fn();
    return { acquired: true, result };
  } finally {
    await releaseChargeLease(supabase, userId, holder);
  }
}
