-- KAN-168: Premium COP prices 4.900 / 49.000 + confirm 5 GB storage + DB quota guard
--
-- Official Wompi COP prices (KAN-168, supersedes KAN-164 9.900 / 99.000):
--   Premium month 4.900 COP = 490000 cents
--   Premium year 49.000 COP = 4900000 cents
--   (yearly ≈ 10 months, matching marketing site; ≈ USD 1.48/mo at 3,320 COP/USD)
--
-- USD amount_cents recomputed with the same 3,320 COP/USD rate used in KAN-164 docs:
--   month: 4900/3320 ≈ $1.48 → 148 cents
--   year:  ≈ 10 × $1.48 = $14.80 → 1480 cents
--
-- Storage: Premium max_storage_mb remains 5000 (5 GB total per user). Adds a
-- BEFORE INSERT OR UPDATE OF file_size trigger on asset_attachments so quota
-- cannot be bypassed via direct inserts/updates. Do not apply this migration
-- from the agent; run after review.
-- Does not create or modify any one-time ("pago único") plan.

-- a) Official Premium Wompi COP amount-in-cents (KAN-168)
UPDATE public.billing_plans
SET provider_price_map = jsonb_set(
  COALESCE(provider_price_map, '{}'::jsonb),
  '{wompi}',
  '"490000"'::jsonb
),
amount_cents = 148,
updated_at = now()
WHERE id = 'plan_premium_month';

UPDATE public.billing_plans
SET provider_price_map = jsonb_set(
  COALESCE(provider_price_map, '{}'::jsonb),
  '{wompi}',
  '"4900000"'::jsonb
),
amount_cents = 1480,
updated_at = now()
WHERE id = 'plan_premium_year';

-- b) Reaffirm Premium total storage = 5 GB (5000 MB); keep file/video caps
UPDATE public.billing_plans
SET features = COALESCE(features, '{}'::jsonb)
  || jsonb_build_object(
    'max_storage_mb', 5000,
    'max_file_size_mb', 100,
    'max_video_assets', 5
  ),
updated_at = now()
WHERE id IN ('plan_premium_month', 'plan_premium_year');

-- c) Entitlement helper — MUST stay in sync with TypeScript:
--    src/lib/subscription/limits.ts → fetchActiveSubscription
--    src/lib/billing/dunning.ts → hasPaidEntitlement / hasStatusBasedEntitlement
--      ENTITLEMENT_GRACE_MS = 1 day, DUNNING_WINDOW_DAYS = 5
-- Wompi: period end + grace / past_due dunning window.
-- Stripe/PayU/others: status-based only (active|trialing); past_due is NOT entitled.
CREATE OR REPLACE FUNCTION public.subscription_grants_paid_entitlement(
  p_status text,
  p_provider text,
  p_current_period_end timestamptz,
  p_now timestamptz DEFAULT now()
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_grace interval := interval '1 day';
  v_dunning interval := interval '5 days';
BEGIN
  -- Strict provider match mirrors limits.ts (`sub.provider === 'wompi'`).
  IF p_provider = 'wompi' THEN
    -- hasPaidEntitlement (dunning.ts)
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

  -- hasStatusBasedEntitlement (dunning.ts) — Stripe / PayU / others
  RETURN p_status IN ('active', 'trialing');
END;
$$;

COMMENT ON FUNCTION public.subscription_grants_paid_entitlement(text, text, timestamptz, timestamptz) IS
  'KAN-168: mirrors fetchActiveSubscription entitlement (limits.ts + dunning.ts). Keep in sync.';

-- Resolve max_storage_mb the same way getSubscriptionLimits does:
-- first entitled subscription (updated_at desc), else Free plan, else 50.
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
    AND bs.status IN ('active', 'past_due', 'trialing')
    AND public.subscription_grants_paid_entitlement(
      bs.status,
      bs.provider,
      bs.current_period_end,
      now()
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
  'KAN-168: plan max_storage_mb via entitlement mirroring getSubscriptionLimits (limits.ts).';

-- d) DB-side storage quota enforcement on attachment insert/update of file_size.
-- Authoritative size comes from storage.objects (not client NEW.file_size).
-- Do NOT hardcode bucket_id: KAN-169 makes the app bucket configurable via
-- SUPABASE_STORAGE_BUCKET (e.g. test-assets) in the same Supabase project.
-- After the user-prefix ownership check, resolve by exact name = NEW.file_path
-- across buckets; fail closed if none; if multiple buckets share the name, use
-- the LARGEST size so quota never under-counts. When storage.objects.owner is
-- set, it must match the asset owner (NULL owner allowed for service-role uploads).
CREATE OR REPLACE FUNCTION public.enforce_user_storage_quota()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_used_bytes bigint;
  v_max_mb numeric;
  v_max_bytes bigint;
  v_projected bigint;
  v_old_size bigint;
  v_new_size bigint;
  v_storage_size bigint;
  v_prefix text;
BEGIN
  SELECT da.user_id INTO v_user_id
  FROM public.digital_assets da
  WHERE da.id = NEW.asset_id;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'STORAGE_QUOTA: asset not found for attachment'
      USING ERRCODE = 'P0001';
  END IF;

  -- Serialize concurrent inserts/updates for the same user
  PERFORM pg_advisory_xact_lock(hashtextextended(v_user_id::text, 0));

  v_prefix := v_user_id::text || '/';
  IF NEW.file_path IS NULL
     OR position('/' in NEW.file_path) = 0
     OR left(NEW.file_path, length(v_prefix)) <> v_prefix
     OR NEW.file_path ~ '\.\.|//' THEN
    RAISE EXCEPTION 'STORAGE_QUOTA: invalid or unowned file_path'
      USING ERRCODE = 'P0001';
  END IF;

  -- Fail closed: object must exist; overwrite client-controlled file_size.
  -- Cross-bucket name lookup (no hardcoded bucket_id) for KAN-169 test buckets.
  SELECT MAX((o.metadata->>'size')::bigint)
  INTO v_storage_size
  FROM storage.objects o
  WHERE o.name = NEW.file_path
    AND (o.owner IS NULL OR o.owner = v_user_id);

  IF v_storage_size IS NULL OR v_storage_size < 0 THEN
    RAISE EXCEPTION 'STORAGE_QUOTA: storage object missing or size unavailable for %',
      NEW.file_path
      USING ERRCODE = 'P0001';
  END IF;

  NEW.file_size := v_storage_size;
  v_new_size := v_storage_size;
  v_old_size := 0;
  IF TG_OP = 'UPDATE' THEN
    v_old_size := COALESCE(OLD.file_size, 0);
    IF v_new_size <= v_old_size THEN
      RETURN NEW;
    END IF;
  END IF;

  SELECT COALESCE(SUM(aa.file_size), 0) INTO v_used_bytes
  FROM public.asset_attachments aa
  INNER JOIN public.digital_assets da ON da.id = aa.asset_id
  WHERE da.user_id = v_user_id;

  -- SUM includes the current row on UPDATE; subtract old size then add new
  v_projected := v_used_bytes - v_old_size + v_new_size;

  v_max_mb := public.resolve_user_max_storage_mb(v_user_id);
  v_max_bytes := (v_max_mb * 1024 * 1024)::bigint;

  IF v_projected > v_max_bytes THEN
    RAISE EXCEPTION 'STORAGE_QUOTA_EXCEEDED: used=% limit_mb=%',
      v_used_bytes, v_max_mb
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_user_storage_quota ON public.asset_attachments;

CREATE TRIGGER trg_enforce_user_storage_quota
  BEFORE INSERT OR UPDATE OF file_size ON public.asset_attachments
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_user_storage_quota();

COMMENT ON FUNCTION public.enforce_user_storage_quota() IS
  'KAN-168: reject asset_attachments INSERT/UPDATE(file_size) exceeding plan max_storage_mb. Derives file_size from storage.objects by exact name across buckets (largest size if multi-bucket; owner must match when set). Trigger-only; advisory lock + entitlement-aware plan resolution.';

-- Privilege hygiene (idempotent). Helpers: no client EXECUTE.
-- Trigger function: REVOKE ALL, no GRANT — EXECUTE is checked at CREATE TRIGGER
-- time, not at fire time, so client grants are unnecessary.
REVOKE ALL ON FUNCTION public.subscription_grants_paid_entitlement(text, text, timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.subscription_grants_paid_entitlement(text, text, timestamptz, timestamptz) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.resolve_user_max_storage_mb(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_user_max_storage_mb(uuid) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_user_storage_quota() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_user_storage_quota() FROM anon, authenticated, service_role;
