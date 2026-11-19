-- KAN-168: Keep Premium until current_period_end after CAPE (user period-end cancel).
-- Mirrors TypeScript: src/lib/billing/dunning.ts → subscriptionGrantsPaidEntitlement
--                 and src/lib/subscription/limits.ts → fetchActiveSubscription
-- Do not edit prior migrations; CREATE OR REPLACE + privilege hygiene (idempotent).
--
-- Policy: paid-through ONLY when cancel_at_period_end = true (status active/trialing/
-- past_due, or canceled after cron/webhook flip). Without CAPE → Free immediately.
-- Revoke reasons (dunning/superseded/expired_resubscribe) deny paid-through even with CAPE.

-- Signature change: add p_canceled_reason. Drop prior overloads first.
DROP FUNCTION IF EXISTS public.subscription_grants_paid_entitlement(text, text, timestamptz, timestamptz);
DROP FUNCTION IF EXISTS public.subscription_grants_paid_entitlement(text, text, timestamptz, timestamptz, boolean);

CREATE OR REPLACE FUNCTION public.subscription_grants_paid_entitlement(
  p_status text,
  p_provider text,
  p_current_period_end timestamptz,
  p_now timestamptz DEFAULT now(),
  p_cancel_at_period_end boolean DEFAULT false,
  p_canceled_reason text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_grace interval := interval '1 day';
  v_dunning interval := interval '5 days';
  v_status text;
  v_reason text;
BEGIN
  v_status := lower(trim(COALESCE(p_status, '')));
  v_reason := lower(trim(COALESCE(p_canceled_reason, '')));

  -- Paid-through: CAPE is the sole user period-end signal (mirrors dunning.ts).
  IF COALESCE(p_cancel_at_period_end, false) = true THEN
    IF v_reason IN ('dunning', 'superseded', 'expired_resubscribe') THEN
      RETURN false;
    END IF;
    IF v_status NOT IN ('active', 'trialing', 'past_due', 'canceled', 'cancelled') THEN
      RETURN false;
    END IF;
    IF p_current_period_end IS NULL THEN
      RETURN false;
    END IF;
    -- Wompi: +1 day grace (same as active renewals). Stripe/PayU: exact end.
    IF p_provider = 'wompi' THEN
      RETURN p_now <= (p_current_period_end + v_grace);
    END IF;
    RETURN p_now <= p_current_period_end;
  END IF;

  -- Strict provider match mirrors limits.ts (`sub.provider === 'wompi'`).
  IF p_provider = 'wompi' THEN
    -- hasPaidEntitlement (dunning.ts) — active / trialing / past_due
    IF v_status = 'past_due' THEN
      IF p_current_period_end IS NULL THEN
        RETURN true;
      END IF;
      RETURN p_now <= (p_current_period_end + v_dunning + v_grace);
    END IF;

    IF v_status NOT IN ('active', 'trialing') THEN
      RETURN false;
    END IF;

    IF p_current_period_end IS NULL THEN
      RETURN true;
    END IF;

    RETURN p_now <= (p_current_period_end + v_grace);
  END IF;

  -- hasStatusBasedEntitlement — Stripe / PayU / others (active|trialing only)
  RETURN v_status IN ('active', 'trialing');
END;
$$;

COMMENT ON FUNCTION public.subscription_grants_paid_entitlement(text, text, timestamptz, timestamptz, boolean, text) IS
  'KAN-168: mirrors subscriptionGrantsPaidEntitlement (dunning.ts). CAPE paid-through until current_period_end; revoke reasons / no CAPE → false. Keep in sync.';

CREATE OR REPLACE FUNCTION public.resolve_user_max_storage_mb(p_user_id uuid)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_max_mb numeric;
BEGIN
  -- Prefer highest product tier among entitled paid plans; ignore plan_free.
  -- Tier rule mirrors dunning.ts entitledPlanRank (plan id prefix, NOT amount_cents):
  -- plan_premium_* (300) > plan_necessary_* (200) > other paid (100); tie → newest updated_at.
  -- Entitlement is filtered in WHERE (no pre-rank LIMIT window), so canceled
  -- tombstones that fail subscription_grants_paid_entitlement cannot starve live rows.
  -- LIMIT 1 applies only AFTER tier + updated_at ranking.
  SELECT (bp.features->>'max_storage_mb')::numeric
  INTO v_max_mb
  FROM public.billing_subscriptions bs
  INNER JOIN public.billing_plans bp ON bp.id = bs.plan_id
  WHERE bs.user_id = p_user_id
    AND lower(trim(bs.status)) IN ('active', 'past_due', 'trialing', 'canceled', 'cancelled')
    AND bp.id IS DISTINCT FROM 'plan_free'
    AND public.subscription_grants_paid_entitlement(
      bs.status,
      bs.provider,
      bs.current_period_end,
      now(),
      bs.cancel_at_period_end,
      bs.canceled_reason
    )
  ORDER BY
    CASE
      WHEN bp.id LIKE 'plan_premium_%' THEN 300
      WHEN bp.id LIKE 'plan_necessary_%' THEN 200
      ELSE 100
    END DESC,
    bs.updated_at DESC NULLS LAST
  LIMIT 1;

  IF v_max_mb IS NOT NULL AND v_max_mb > 0 THEN
    RETURN v_max_mb;
  END IF;

  SELECT (features->>'max_storage_mb')::numeric
  INTO v_max_mb
  FROM public.billing_plans
  WHERE id = 'plan_free'
  LIMIT 1;

  IF v_max_mb IS NULL OR v_max_mb <= 0 THEN
    RETURN 50;
  END IF;

  RETURN v_max_mb;
END;
$$;

COMMENT ON FUNCTION public.resolve_user_max_storage_mb(uuid) IS
  'KAN-168: plan max_storage_mb via entitlement mirroring getSubscriptionLimits (CAPE paid-through; tier rank plan_premium_ > plan_necessary_ > other).';

-- Privilege hygiene (idempotent). Helpers: no client EXECUTE.
REVOKE ALL ON FUNCTION public.subscription_grants_paid_entitlement(text, text, timestamptz, timestamptz, boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.subscription_grants_paid_entitlement(text, text, timestamptz, timestamptz, boolean, text) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.resolve_user_max_storage_mb(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_user_max_storage_mb(uuid) FROM anon, authenticated;
