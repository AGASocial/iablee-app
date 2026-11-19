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
-- BEFORE INSERT trigger on asset_attachments so quota cannot be bypassed via
-- direct inserts. Do not apply this migration from the agent; run after review.
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

-- c) DB-side storage quota enforcement on attachment insert
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
  v_new_size bigint;
BEGIN
  SELECT da.user_id INTO v_user_id
  FROM public.digital_assets da
  WHERE da.id = NEW.asset_id;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'STORAGE_QUOTA: asset not found for attachment'
      USING ERRCODE = 'P0001';
  END IF;

  v_new_size := COALESCE(NEW.file_size, 0);

  SELECT COALESCE(SUM(aa.file_size), 0) INTO v_used_bytes
  FROM public.asset_attachments aa
  INNER JOIN public.digital_assets da ON da.id = aa.asset_id
  WHERE da.user_id = v_user_id;

  -- Prefer features from an entitled subscription plan; else Free plan; else 50 MB
  SELECT COALESCE(
    (
      SELECT (bp.features->>'max_storage_mb')::numeric
      FROM public.billing_subscriptions bs
      INNER JOIN public.billing_plans bp ON bp.id = bs.plan_id
      WHERE bs.user_id = v_user_id
        AND bs.status IN ('active', 'past_due', 'trialing')
      ORDER BY bs.updated_at DESC NULLS LAST
      LIMIT 1
    ),
    (
      SELECT (features->>'max_storage_mb')::numeric
      FROM public.billing_plans
      WHERE id = 'plan_free'
      LIMIT 1
    ),
    50
  ) INTO v_max_mb;

  IF v_max_mb IS NULL OR v_max_mb <= 0 THEN
    v_max_mb := 50;
  END IF;

  v_max_bytes := (v_max_mb * 1024 * 1024)::bigint;

  IF (v_used_bytes + v_new_size) > v_max_bytes THEN
    RAISE EXCEPTION 'STORAGE_QUOTA_EXCEEDED: used=% limit_mb=%',
      v_used_bytes, v_max_mb
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_user_storage_quota ON public.asset_attachments;

CREATE TRIGGER trg_enforce_user_storage_quota
  BEFORE INSERT ON public.asset_attachments
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_user_storage_quota();

COMMENT ON FUNCTION public.enforce_user_storage_quota() IS
  'KAN-168: reject asset_attachments inserts that would exceed the user plan max_storage_mb (Premium = 5000 MB / 5 GB).';
