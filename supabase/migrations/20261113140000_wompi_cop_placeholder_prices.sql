-- Wompi COP amount-in-cents for provider_price_map.wompi
-- KAN-139
--
-- Official COP prices confirmed 2026-11-13 (KAN-139).
-- Values must match src/lib/billing/wompi-pricing.ts (WOMPI_PLAN_AMOUNT_COP_CENTS).
-- Filename retained (…_placeholder_…) to avoid migration history/apply confusion.
--
-- amount-in-cents: 4000000 = 40,000.00 COP
-- Previously unapplied while prices were pending confirmation; ready to apply when deploying Wompi.
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
