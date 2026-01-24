-- Seed initial billing plans
-- These plans define the subscription tiers for the iablee platform

-- Free Plan
INSERT INTO public.billing_plans (id, name, currency, amount_cents, interval, features, provider_price_map)
VALUES (
  'plan_free',
  'Free',
  'USD',
  0,
  'month',
  '{
    "max_assets": 3,
    "max_beneficiaries": 2,
    "max_file_size_mb": 10,
    "max_storage_mb": 50,
    "priority_support": false,
    "advanced_security": false
  }'::jsonb,
  '{}'::jsonb
) ON CONFLICT (id) DO NOTHING;

-- Necessary Plan - Monthly
INSERT INTO public.billing_plans (id, name, currency, amount_cents, interval, features, provider_price_map)
VALUES (
  'plan_necessary_month',
  'Necessary',
  'USD',
  999,
  'month',
  '{
    "max_assets": 50,
    "max_beneficiaries": 10,
    "max_file_size_mb": 100,
    "max_storage_mb": 5000,
    "priority_support": false,
    "advanced_security": true
  }'::jsonb,
  '{
    "stripe": "price_necessary_monthly",
    "paypal": "PLAN-NECESSARY-MONTHLY",
    "wompi": "necessary_monthly",
    "payu": "NECESSARY-MONTHLY"
  }'::jsonb
) ON CONFLICT (id) DO NOTHING;

-- Necessary Plan - Yearly
INSERT INTO public.billing_plans (id, name, currency, amount_cents, interval, features, provider_price_map)
VALUES (
  'plan_necessary_year',
  'Necessary',
  'USD',
  9999,
  'year',
  '{
    "max_assets": 50,
    "max_beneficiaries": 10,
    "max_file_size_mb": 100,
    "max_storage_mb": 5000,
    "priority_support": false,
    "advanced_security": true
  }'::jsonb,
  '{
    "stripe": "price_necessary_yearly",
    "paypal": "PLAN-NECESSARY-YEARLY",
    "wompi": "necessary_yearly",
    "payu": "NECESSARY-YEARLY"
  }'::jsonb
) ON CONFLICT (id) DO NOTHING;

-- Premium Plan - Monthly
INSERT INTO public.billing_plans (id, name, currency, amount_cents, interval, features, provider_price_map)
VALUES (
  'plan_premium_month',
  'Premium',
  'USD',
  1999,
  'month',
  '{
    "max_assets": -1,
    "max_beneficiaries": -1,
    "max_file_size_mb": 500,
    "max_storage_mb": 50000,
    "priority_support": true,
    "advanced_security": true
  }'::jsonb,
  '{
    "stripe": "price_premium_monthly",
    "paypal": "PLAN-PREMIUM-MONTHLY",
    "wompi": "premium_monthly",
    "payu": "PREMIUM-MONTHLY"
  }'::jsonb
) ON CONFLICT (id) DO NOTHING;

-- Premium Plan - Yearly
INSERT INTO public.billing_plans (id, name, currency, amount_cents, interval, features, provider_price_map)
VALUES (
  'plan_premium_year',
  'Premium',
  'USD',
  19999,
  'year',
  '{
    "max_assets": -1,
    "max_beneficiaries": -1,
    "max_file_size_mb": 500,
    "max_storage_mb": 50000,
    "priority_support": true,
    "advanced_security": true
  }'::jsonb,
  '{
    "stripe": "price_premium_yearly",
    "paypal": "PLAN-PREMIUM-YEARLY",
    "wompi": "premium_yearly",
    "payu": "PREMIUM-YEARLY"
  }'::jsonb
) ON CONFLICT (id) DO NOTHING;

-- Note: -1 in features indicates "unlimited"
-- Provider price IDs are placeholders and should be updated with actual IDs from each payment provider
