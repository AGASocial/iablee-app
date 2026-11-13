-- Wompi COP amount-in-cents placeholders for provider_price_map.wompi
-- KAN-139
--
-- DO NOT treat these as official production prices.
-- TODO(Gabriel): Confirm official COP prices with finance / Wompi go-live checklist
-- before applying in production. Values must match src/lib/billing/wompi-pricing.ts.
--
-- amount-in-cents: 4000000 = 40,000.00 COP
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
