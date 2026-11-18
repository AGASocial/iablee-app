/**
 * Per-user charge leases (KAN-166).
 * Serialize first-charge, renewal charge, and reactivation/activation writes.
 *
 * Production: SECURITY DEFINER RPC only — fail closed on RPC errors.
 * Tests: inject via configureChargeLeaseForTests (never grant on missing rpc).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

/** Cover cron maxDuration (300s) + Wompi wait + write margin. */
export const CHARGE_LEASE_TTL_SECONDS = 10 * 60;

export type ChargeLeaseTestConfig = {
  /** Unit tests: acquire always succeeds without RPC. */
  alwaysGrant?: boolean;
  /** Unit tests only: allow non-atomic client CAS. Never enable in production. */
  allowClientCas?: boolean;
};

let testConfig: ChargeLeaseTestConfig = {};

/** Test seam — reset in afterEach when overriding defaults. */
export function configureChargeLeaseForTests(
  config: ChargeLeaseTestConfig | null
): void {
  testConfig = config ? { ...config } : {};
}

/**
 * Acquire a per-user charge lease. Returns false if another holder owns a
 * non-expired lease, or if the RPC fails (fail closed).
 */
export async function acquireChargeLease(
  supabase: SupabaseClient,
  userId: string,
  holder: string,
  ttlSeconds = CHARGE_LEASE_TTL_SECONDS
): Promise<boolean> {
  if (testConfig.alwaysGrant) {
    return true;
  }

  if (typeof supabase.rpc === 'function') {
    const { data, error } = await supabase.rpc('acquire_billing_charge_lease', {
      p_user_id: userId,
      p_holder: holder,
      p_ttl_seconds: ttlSeconds,
    });
    if (error) {
      console.error(
        '[billing] acquire_billing_charge_lease RPC failed — fail closed',
        error.message
      );
      return false;
    }
    return data === true;
  }

  if (testConfig.allowClientCas) {
    return acquireChargeLeaseClientCas(supabase, userId, holder, ttlSeconds);
  }

  console.error(
    '[billing] acquire_billing_charge_lease unavailable (no rpc) — fail closed'
  );
  return false;
}

/**
 * Extend TTL for the same holder. Returns false if the lease was lost
 * (another holder stole it or it expired without renew).
 */
export async function refreshChargeLease(
  supabase: SupabaseClient,
  userId: string,
  holder: string,
  ttlSeconds = CHARGE_LEASE_TTL_SECONDS
): Promise<boolean> {
  if (testConfig.alwaysGrant) {
    return true;
  }
  // Same-holder renew is built into acquire RPC
  return acquireChargeLease(supabase, userId, holder, ttlSeconds);
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
  if (testConfig.alwaysGrant) {
    return;
  }

  if (typeof supabase.rpc === 'function') {
    const { error } = await supabase.rpc('release_billing_charge_lease', {
      p_user_id: userId,
      p_holder: holder,
    });
    if (!error) return;
    console.error(
      '[billing] release_billing_charge_lease RPC failed — leaving lease to TTL',
      error.message
    );
    return;
  }

  if (testConfig.allowClientCas) {
    await supabase
      .from('billing_charge_leases')
      .delete()
      .eq('user_id', userId)
      .eq('holder', holder);
    return;
  }

  console.error(
    '[billing] release_billing_charge_lease unavailable (no rpc) — leaving lease to TTL'
  );
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
