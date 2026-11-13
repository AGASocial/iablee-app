/**
 * Select-then-update/insert helpers for billing rows keyed by provider IDs.
 *
 * Prefer these over PostgREST upsert({ onConflict }) when the DB may not yet
 * have UNIQUE constraints on provider_*_id columns.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type PersistResult = 'updated' | 'inserted';

/**
 * Persist a row keyed by a non-null provider id column:
 * SELECT by provider id → UPDATE if found, else INSERT.
 */
export async function persistByProviderId(
  supabase: SupabaseClient,
  table: 'billing_invoices' | 'billing_subscriptions',
  providerIdColumn: 'provider_invoice_id' | 'provider_subscription_id',
  providerId: string,
  payload: Record<string, unknown>
): Promise<PersistResult> {
  const { data: existing, error: selectError } = await supabase
    .from(table)
    .select('id')
    .eq(providerIdColumn, providerId)
    .maybeSingle();

  if (selectError) {
    throw selectError;
  }

  if (existing?.id) {
    const { error: updateError } = await supabase
      .from(table)
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', existing.id);

    if (updateError) {
      throw updateError;
    }
    return 'updated';
  }

  const { error: insertError } = await supabase.from(table).insert({
    ...payload,
    [providerIdColumn]: providerId,
  });

  if (insertError) {
    throw insertError;
  }
  return 'inserted';
}
