-- Check current Stripe price IDs in database
SELECT
  id,
  name,
  amount_cents,
  interval,
  provider_price_map->'stripe' as stripe_price_id
FROM billing_plans
WHERE id != 'plan_free'
ORDER BY name, interval;
