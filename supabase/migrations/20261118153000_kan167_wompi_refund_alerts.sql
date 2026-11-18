-- KAN-167: requires_refund ops alerting + resolution tracking
-- Re-runnable. Do NOT apply automatically against production without review.

-- ---------------------------------------------------------------------------
-- billing_renewal_attempts: alert / resolve columns for requires_refund
-- ---------------------------------------------------------------------------
ALTER TABLE public.billing_renewal_attempts
  ADD COLUMN IF NOT EXISTS refund_alerted_at timestamp with time zone NULL,
  ADD COLUMN IF NOT EXISTS refund_resolved_at timestamp with time zone NULL,
  ADD COLUMN IF NOT EXISTS refund_resolution_note text NULL;

COMMENT ON COLUMN public.billing_renewal_attempts.refund_alerted_at IS
  'Set when admin refund alert email was successfully claimed/sent (CAS dedupe).';
COMMENT ON COLUMN public.billing_renewal_attempts.refund_resolved_at IS
  'Ops marks after manual Wompi dashboard refund; NULL = still unresolved.';
COMMENT ON COLUMN public.billing_renewal_attempts.refund_resolution_note IS
  'Optional note when marking refund resolved (who/why).';

CREATE INDEX IF NOT EXISTS billing_renewal_attempts_unresolved_refund_idx
  ON public.billing_renewal_attempts (requires_refund, refund_resolved_at)
  WHERE requires_refund = true AND refund_resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS billing_renewal_attempts_unalerted_refund_idx
  ON public.billing_renewal_attempts (requires_refund, refund_alerted_at)
  WHERE requires_refund = true AND refund_alerted_at IS NULL;

-- ---------------------------------------------------------------------------
-- billing_email_events: allow daily refund summary dedupe type
-- Constraint name may be auto-generated; drop both common forms then re-add.
-- ---------------------------------------------------------------------------
ALTER TABLE public.billing_email_events
  DROP CONSTRAINT IF EXISTS billing_email_events_email_type_check;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.billing_email_events'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%email_type%'
  ) THEN
    EXECUTE (
      SELECT 'ALTER TABLE public.billing_email_events DROP CONSTRAINT ' || quote_ident(conname)
      FROM pg_constraint
      WHERE conrelid = 'public.billing_email_events'::regclass
        AND contype = 'c'
        AND pg_get_constraintdef(oid) ILIKE '%email_type%'
      LIMIT 1
    );
  END IF;
END $$;

ALTER TABLE public.billing_email_events
  ADD CONSTRAINT billing_email_events_email_type_check
  CHECK (
    email_type IN (
      'renewal_success',
      'payment_failed',
      'upcoming_renewal',
      'downgrade_to_free',
      'refund_summary'
    )
  );

-- One refund_summary email per UTC day (period_key = refund_summary_YYYYMMDD),
-- independent of which user_id is used to satisfy the FK on insert.
CREATE UNIQUE INDEX IF NOT EXISTS billing_email_events_refund_summary_day_uidx
  ON public.billing_email_events (email_type, period_key)
  WHERE email_type = 'refund_summary';
