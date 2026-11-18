-- KAN-166: Wompi payment sources + renewal attempts + billing email idempotency
-- DO NOT auto-apply; review before supabase db push (env may point at production).

-- ---------------------------------------------------------------------------
-- billing_payment_methods: support Wompi payment sources (CARD / NEQUI)
-- Stripe continues to use provider_customer_id + token (pm_xxx).
-- ---------------------------------------------------------------------------
ALTER TABLE public.billing_payment_methods
  ALTER COLUMN provider_customer_id DROP NOT NULL;

ALTER TABLE public.billing_payment_methods
  ADD COLUMN IF NOT EXISTS method_type text NULL,
  ADD COLUMN IF NOT EXISTS provider_payment_source_id text NULL,
  ADD COLUMN IF NOT EXISTS phone_last4 text NULL,
  ADD COLUMN IF NOT EXISTS voided_at timestamp with time zone NULL;

COMMENT ON COLUMN public.billing_payment_methods.method_type IS
  'CARD | NEQUI for Wompi; null/card for Stripe vault methods';
COMMENT ON COLUMN public.billing_payment_methods.provider_payment_source_id IS
  'Wompi payment_source_id (numeric as text). Never store PAN/CVC.';
COMMENT ON COLUMN public.billing_payment_methods.phone_last4 IS
  'Last 4 digits of Nequi phone when method_type=NEQUI';

CREATE UNIQUE INDEX IF NOT EXISTS billing_payment_methods_wompi_source_uidx
  ON public.billing_payment_methods (provider, provider_payment_source_id)
  WHERE provider_payment_source_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- billing_renewal_attempts: claim-before-charge idempotency for cron renewals
-- Unique (subscription_id, period_end, attempt_number) prevents double charges.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.billing_renewal_attempts (
  id uuid not null default gen_random_uuid(),
  subscription_id uuid not null,
  user_id uuid not null,
  period_end timestamp with time zone not null,
  attempt_number integer not null CHECK (attempt_number >= 1),
  status text not null CHECK (
    status IN ('claimed', 'pending', 'approved', 'declined', 'error', 'skipped')
  ),
  wompi_reference text not null,
  wompi_transaction_id text null,
  amount_cents integer null,
  currency text null default 'COP',
  error_message text null,
  claimed_at timestamp with time zone not null default now(),
  finalized_at timestamp with time zone null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint billing_renewal_attempts_pkey primary key (id),
  constraint billing_renewal_attempts_subscription_id_fkey
    foreign key (subscription_id) references billing_subscriptions (id) on delete cascade,
  constraint billing_renewal_attempts_user_id_fkey
    foreign key (user_id) references users (id) on delete cascade,
  constraint billing_renewal_attempts_unique_attempt
    unique (subscription_id, period_end, attempt_number),
  constraint billing_renewal_attempts_reference_unique
    unique (wompi_reference)
) TABLESPACE pg_default;

CREATE INDEX IF NOT EXISTS billing_renewal_attempts_status_idx
  ON public.billing_renewal_attempts (status);

CREATE INDEX IF NOT EXISTS billing_renewal_attempts_subscription_idx
  ON public.billing_renewal_attempts (subscription_id);

CREATE INDEX IF NOT EXISTS billing_renewal_attempts_pending_tx_idx
  ON public.billing_renewal_attempts (wompi_transaction_id)
  WHERE status = 'pending' AND wompi_transaction_id IS NOT NULL;

ALTER TABLE public.billing_renewal_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own renewal attempts"
  ON public.billing_renewal_attempts
  FOR SELECT
  USING (auth.uid() = user_id);

-- Writes via service role only (no INSERT/UPDATE/DELETE policies for authenticated)

CREATE TRIGGER set_billing_renewal_attempts_updated_at
  BEFORE UPDATE ON public.billing_renewal_attempts
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- ---------------------------------------------------------------------------
-- billing_email_events: idempotent billing notification markers
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.billing_email_events (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  subscription_id uuid null,
  email_type text not null CHECK (
    email_type IN (
      'renewal_success',
      'payment_failed',
      'upcoming_renewal',
      'downgrade_to_free'
    )
  ),
  period_key text not null,
  provider text null,
  metadata jsonb null default '{}'::jsonb,
  sent_at timestamp with time zone not null default now(),
  created_at timestamp with time zone not null default now(),
  constraint billing_email_events_pkey primary key (id),
  constraint billing_email_events_user_id_fkey
    foreign key (user_id) references users (id) on delete cascade,
  constraint billing_email_events_subscription_id_fkey
    foreign key (subscription_id) references billing_subscriptions (id) on delete set null,
  constraint billing_email_events_idempotent
    unique (user_id, email_type, period_key)
) TABLESPACE pg_default;

CREATE INDEX IF NOT EXISTS billing_email_events_user_idx
  ON public.billing_email_events (user_id);

ALTER TABLE public.billing_email_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own billing email events"
  ON public.billing_email_events
  FOR SELECT
  USING (auth.uid() = user_id);

-- Writes via service role only
