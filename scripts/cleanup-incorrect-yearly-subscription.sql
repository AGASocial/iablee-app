-- Delete the incorrect yearly subscription with wrong renewal date
-- This subscription has current_period_end in 2025 instead of 2026
DELETE FROM billing_subscriptions
WHERE plan_id = 'plan_necessary_year'
  AND current_period_end < '2026-01-01';

-- Verify it's deleted
SELECT
  id,
  user_id,
  plan_id,
  status,
  current_period_end,
  provider_subscription_id,
  created_at
FROM billing_subscriptions
ORDER BY created_at DESC;
