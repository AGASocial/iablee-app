-- Wompi COP amount-in-cents for provider_price_map.wompi
-- KAN-139
--
-- NOTE (KAN-164, 2026-11-17): The Premium amounts below (80k/800k COP) and the
-- "confirmed 2026-11-13" wording were unconfirmed placeholders. Official Premium
-- Wompi prices are 9.900 / 99.000 COP in
-- 20261118000000_kan164_free_premium_visibility.sql. Necessary amounts here remain
-- legacy fallbacks for hidden-plan renewals only. Do not rewrite this SQL body.
-- Filename retained (…_placeholder_…) to avoid migration history/apply confusion.
--
-- amount-in-cents: 4000000 = 40,000.00 COP (legacy Necessary)
-- This migration is intentionally NOT applied by the agent; run manually when ready.

UPDATE public.billing_plans
SET provider_price_map = jsonb_set(
  COALESCE(provider_price_map, '{}'::jsonb),
  '{wompi}',
  '"4000000"'::jsonb
)
WHERE id = 'plan_necessary_month';

UPDATE public.billing_plans
SET provider_price_map = jsonb_set(
  COALESCE(provider_price_map, '{}'::jsonb),
  '{wompi}',
  '"40000000"'::jsonb
)
WHERE id = 'plan_necessary_year';

UPDATE public.billing_plans
SET provider_price_map = jsonb_set(
  COALESCE(provider_price_map, '{}'::jsonb),
  '{wompi}',
  '"8000000"'::jsonb
)
WHERE id = 'plan_premium_month';

UPDATE public.billing_plans
SET provider_price_map = jsonb_set(
  COALESCE(provider_price_map, '{}'::jsonb),
  '{wompi}',
  '"80000000"'::jsonb
)
WHERE id = 'plan_premium_year';
