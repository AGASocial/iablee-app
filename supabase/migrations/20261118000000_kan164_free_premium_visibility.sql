-- KAN-164: Simplify to Free + Premium (visible); hide Necessary; update COP prices & limits
--
-- Official Wompi COP prices confirmed 2026-11-17 (KAN-164):
--   Premium month 9.900 COP = 990000 cents
--   Premium year  99.000 COP = 9900000 cents
--   (yearly ≈ 10 months, matching marketing site; ≈ USD 2.99/mo at 3,320 COP/USD)
--
-- The 40k/80k figures in 20261113140000_wompi_cop_placeholder_prices.sql were
-- unconfirmed placeholders (incorrectly documented as confirmed 2026-11-13 / KAN-139).
-- Do not rewrite that migration body; this file supersedes Premium Wompi amounts.
-- Necessary Wompi map values are left as legacy for hidden-plan renewals only.
--
-- Necessary plans are hidden via is_visible=false (NOT deleted) so existing
-- subscribers keep working. Do not apply this migration from the agent; run after review.

-- a) Visibility flag for public plan catalogs / checkout eligibility
ALTER TABLE public.billing_plans
  ADD COLUMN IF NOT EXISTS is_visible boolean NOT NULL DEFAULT true;

-- b) Hide Necessary from purchasable catalogs
UPDATE public.billing_plans
SET is_visible = false,
    updated_at = now()
WHERE id IN ('plan_necessary_month', 'plan_necessary_year');

-- Ensure Free + Premium remain visible
UPDATE public.billing_plans
SET is_visible = true,
    updated_at = now()
WHERE id IN ('plan_free', 'plan_premium_month', 'plan_premium_year');

-- c) Free: max_beneficiaries 1 (was 2); leave other features unchanged
UPDATE public.billing_plans
SET features = jsonb_set(
  COALESCE(features, '{}'::jsonb),
  '{max_beneficiaries}',
  '1'::jsonb
),
updated_at = now()
WHERE id = 'plan_free';

-- d) Premium limits (KAN-164):
--    max_beneficiaries 10 (was -1 unlimited; NOT 6)
--    max_storage_mb 5000 (5 GB; was 50000)
--    max_file_size_mb 100 (was 500)
--    max_video_assets 5 (site: "5 videos informativos"; assets overall stay unlimited)
UPDATE public.billing_plans
SET features = COALESCE(features, '{}'::jsonb)
  || jsonb_build_object(
    'max_beneficiaries', 10,
    'max_storage_mb', 5000,
    'max_file_size_mb', 100,
    'max_video_assets', 5
  ),
updated_at = now()
WHERE id IN ('plan_premium_month', 'plan_premium_year');

-- e) Official Premium Wompi COP amount-in-cents (KAN-164)
UPDATE public.billing_plans
SET provider_price_map = jsonb_set(
  COALESCE(provider_price_map, '{}'::jsonb),
  '{wompi}',
  '"990000"'::jsonb
),
updated_at = now()
WHERE id = 'plan_premium_month';

UPDATE public.billing_plans
SET provider_price_map = jsonb_set(
  COALESCE(provider_price_map, '{}'::jsonb),
  '{wompi}',
  '"9900000"'::jsonb
),
updated_at = now()
WHERE id = 'plan_premium_year';

-- f) Necessary Wompi map values intentionally left as legacy (hidden plan renewals)
