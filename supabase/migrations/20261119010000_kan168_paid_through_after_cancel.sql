-- KAN-168: Keep Premium until current_period_end after cancel / cancel_at_period_end.
-- Mirrors TypeScript: src/lib/billing/dunning.ts → subscriptionGrantsPaidEntitlement
--                 and src/lib/subscription/limits.ts → fetchActiveSubscription
-- Do not edit prior migrations; CREATE OR REPLACE + privilege hygiene (idempotent).

-- Signature change: add p_cancel_at_period_end. Drop 4-arg overload first.
DROP FUNCTION IF EXISTS public.subscription_grants_paid_entitlement(text, text, timestamptz, timestamptz);

CREATE OR REPLACE FUNCTION public.subscription_grants_paid_entitlement(
  p_status text,
  p_provider text,
  p_current_period_end timestamptz,
  p_now timestamptz DEFAULT now(),
  p_cancel_at_period_end boolean DEFAULT false
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_grace interval := interval '1 day';
  v_dunning interval := interval '5 days';
  v_is_ending boolean;
BEGIN
  v_is_ending :=
    p_status IN ('canceled', 'cancelled')
    OR COALESCE(p_cancel_at_period_end, false) = true;

  -- Paid-through after cancel (KAN-168): require known period end (fail closed).
  IF v_is_ending THEN
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
    IF p_status = 'past_due' THEN
      IF p_current_period_end IS NULL THEN
        RETURN true;
      END IF;
      RETURN p_now <= (p_current_period_end + v_dunning + v_grace);
    END IF;

    IF p_status NOT IN ('active', 'trialing') THEN
      RETURN false;
    END IF;

    IF p_current_period_end IS NULL THEN
      RETURN true;
    END IF;

    RETURN p_now <= (p_current_period_end + v_grace);
  END IF;

  -- hasStatusBasedEntitlement — Stripe / PayU / others (active|trialing only)
  RETURN p_status IN ('active', 'trialing');
END;
$$;

COMMENT ON FUNCTION public.subscription_grants_paid_entitlement(text, text, timestamptz, timestamptz, boolean) IS
  'KAN-168: mirrors subscriptionGrantsPaidEntitlement (dunning.ts). Canceled/CAPE paid-through until current_period_end; NULL period end → false. Keep in sync.';

CREATE OR REPLACE FUNCTION public.resolve_user_max_storage_mb(p_user_id uuid)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_max_mb numeric;
BEGIN
  SELECT (bp.features->>'max_storage_mb')::numeric
  INTO v_max_mb
  FROM public.billing_subscriptions bs
  INNER JOIN public.billing_plans bp ON bp.id = bs.plan_id
  WHERE bs.user_id = p_user_id
    AND bs.status IN ('active', 'past_due', 'trialing', 'canceled', 'cancelled')
    AND public.subscription_grants_paid_entitlement(
      bs.status,
      bs.provider,
      bs.current_period_end,
      now(),
      bs.cancel_at_period_end
    )
  ORDER BY bs.updated_at DESC NULLS LAST
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
  'KAN-168: plan max_storage_mb via entitlement mirroring getSubscriptionLimits (incl. canceled paid-through).';

-- Privilege hygiene (idempotent). Helpers: no client EXECUTE.
REVOKE ALL ON FUNCTION public.subscription_grants_paid_entitlement(text, text, timestamptz, timestamptz, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.subscription_grants_paid_entitlement(text, text, timestamptz, timestamptz, boolean) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.resolve_user_max_storage_mb(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_user_max_storage_mb(uuid) FROM anon, authenticated;
