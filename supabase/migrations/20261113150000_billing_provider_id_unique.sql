-- DO NOT APPLY until reviewed.
-- Next `supabase db push` (or equivalent) would apply this migration.
-- Added for KAN-139: billing upserts historically relied on onConflict for
-- provider_invoice_id / provider_subscription_id, but those columns had no UNIQUE
-- constraint. Application code now uses select-then-update/insert; this migration
-- adds the UNIQUE indexes so future upserts (and data integrity) are safe.
-- Columns are NOT NULL, so a plain UNIQUE index is fine (no null-collision concern).

CREATE UNIQUE INDEX IF NOT EXISTS billing_invoices_provider_invoice_id_uidx
  ON public.billing_invoices (provider_invoice_id);

CREATE UNIQUE INDEX IF NOT EXISTS billing_subscriptions_provider_subscription_id_uidx
  ON public.billing_subscriptions (provider_subscription_id);
