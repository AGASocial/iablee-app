-- Delete incomplete subscriptions that were created incorrectly
DELETE FROM billing_subscriptions
WHERE status = 'incomplete';

-- Verify they're gone
SELECT * FROM billing_subscriptions;
