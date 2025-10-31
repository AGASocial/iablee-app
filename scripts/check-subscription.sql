-- Check current subscription details
SELECT
  id,
  user_id,
  plan_id,
  status,
  current_period_end,
  provider_subscription_id,
  created_at
FROM billing_subscriptions
WHERE status = 'active'
ORDER BY created_at DESC
LIMIT 1;
