-- Update billing_plans with real Stripe price IDs
-- Based on prices.csv from Stripe export

-- Necessary Plan - Monthly ($9.99/month)
UPDATE billing_plans
SET provider_price_map = jsonb_set(
  provider_price_map,
  '{stripe}',
  '"price_1SO9HHE3O31AtXXLhSC2nHij"'
)
WHERE id = 'plan_necessary_month';

-- Necessary Plan - Yearly ($99.99/year)
UPDATE billing_plans
SET provider_price_map = jsonb_set(
  provider_price_map,
  '{stripe}',
  '"price_1SO9HBE3O31AtXXLkumQk2qr"'
)
WHERE id = 'plan_necessary_year';

-- Premium Plan - Monthly ($19.99/month)
UPDATE billing_plans
SET provider_price_map = jsonb_set(
  provider_price_map,
  '{stripe}',
  '"price_1SO9GgE3O31AtXXLWx0dnwGz"'
)
WHERE id = 'plan_premium_month';

-- Premium Plan - Yearly ($199.99/year)
UPDATE billing_plans
SET provider_price_map = jsonb_set(
  provider_price_map,
  '{stripe}',
  '"price_1SO9GyE3O31AtXXLwKC6vyie"'
)
WHERE id = 'plan_premium_year';

-- Verify the updates
SELECT
  id,
  name,
  amount_cents,
  interval,
  provider_price_map->'stripe' as stripe_price_id
FROM billing_plans
WHERE id != 'plan_free'
ORDER BY name, interval;
