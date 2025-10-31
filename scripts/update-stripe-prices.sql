-- Update Stripe price IDs in database
-- Replace price_xxxxx with your actual Stripe price IDs from Stripe Dashboard

-- Necessary Plan - Monthly
UPDATE billing_plans
SET provider_price_map = jsonb_set(
  provider_price_map,
  '{stripe}',
  '"price_REPLACE_WITH_YOUR_NECESSARY_MONTHLY_PRICE_ID"'
)
WHERE id = 'plan_necessary_month';

-- Necessary Plan - Yearly
UPDATE billing_plans
SET provider_price_map = jsonb_set(
  provider_price_map,
  '{stripe}',
  '"price_REPLACE_WITH_YOUR_NECESSARY_YEARLY_PRICE_ID"'
)
WHERE id = 'plan_necessary_year';

-- Premium Plan - Monthly
UPDATE billing_plans
SET provider_price_map = jsonb_set(
  provider_price_map,
  '{stripe}',
  '"price_REPLACE_WITH_YOUR_PREMIUM_MONTHLY_PRICE_ID"'
)
WHERE id = 'plan_premium_month';

-- Premium Plan - Yearly
UPDATE billing_plans
SET provider_price_map = jsonb_set(
  provider_price_map,
  '{stripe}',
  '"price_REPLACE_WITH_YOUR_PREMIUM_YEARLY_PRICE_ID"'
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
