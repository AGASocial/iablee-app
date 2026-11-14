# Billing & Subscription System - Setup Guide

This document provides a comprehensive guide for the newly implemented billing and subscription system.

## Overview

The billing system is **provider-agnostic**. Implemented gateways:

| Gateway | Model | Notes |
|---------|--------|--------|
| **PayU** | Hosted WebCheckout (POST form) | Default `PAYMENT_GATEWAY` |
| **Stripe** | Customer vault + native subscriptions | Requires saved payment method |
| **Wompi** (Colombia) | Hosted Web Checkout (GET form) | COP only; renew-by-checkout (KAN-139) |

PayPal remains a type placeholder only.

## What Has Been Implemented

### 1. Database Layer ✅
- **5 new tables** with RLS policies:
  - `billing_plans` - Subscription plan definitions
  - `billing_subscriptions` - User subscriptions
  - `billing_payment_methods` - Stored payment methods
  - `billing_invoices` - Invoice records
  - `billing_webhook_events` - Webhook event log for idempotency
- **3 initial plans seeded**:
  - Free Plan: $0/month (3 assets, 2 beneficiaries)
  - Necessary Plan: $9.99/month or $99.99/year (50 assets, 10 beneficiaries)
  - Premium Plan: $19.99/month or $199.99/year (unlimited assets & beneficiaries)

### 2. Domain Layer ✅
- **Provider-agnostic interfaces**:
  - `PaymentGateway` - Interface all payment providers must implement
  - `WebhookNormalizer` - Interface for normalizing webhook events
- **TypeScript types** for billing entities (plans, subscriptions, invoices, etc.)
- **BillingService** - Domain orchestration layer that handles all billing operations
- **Error types** - Custom error classes for billing operations

### 3. Provider Adapters ✅
- **StripeAdapter** - Complete Stripe implementation:
  - Customer management
  - Payment method handling
  - Subscription lifecycle (create, update, cancel, reactivate)
  - Invoice operations
  - Checkout sessions
  - Billing portal sessions
- **StripeWebhookNormalizer** - Converts Stripe webhooks to normalized domain events
- **PayUAdapter** / **PayUWebhookNormalizer** - WebCheckout + confirmation webhook
- **WompiAdapter** / **WompiWebhookNormalizer** - Web Checkout (GET) + `transaction.updated` events

### 4. API Endpoints ✅
- `GET /api/billing/plans` - List all available plans
- `GET /api/billing/subscriptions` - Get user's subscription
- `POST /api/billing/subscriptions` - Create subscription
- `PATCH /api/billing/subscriptions` - Update subscription
- `DELETE /api/billing/subscriptions` - Cancel subscription
- `GET /api/billing/payment-methods` - List payment methods
- `POST /api/billing/payment-methods` - Add payment method
- `GET /api/billing/invoices` - List invoices
- `POST /api/webhooks/stripe` - Stripe webhook endpoint
- `POST /api/webhooks/payu` - PayU confirmation webhook endpoint (WebCheckout)
- `POST /api/webhooks/wompi` - Wompi events webhook (`transaction.updated`)
- `GET /api/payments/wompi/transaction` - Informational transaction lookup for return page

### 5. Database Types ✅
- Updated `src/lib/supabase.ts` with all billing table types

## Setup Instructions

### Step 1: Environment Variables

Add the following to your `.env.local`:

```bash
# Payment Gateway Configuration
# Default in application code is payu. Supported: payu | stripe | wompi
PAYMENT_GATEWAY=payu
NEXT_PUBLIC_PAYMENT_GATEWAY=payu

# Stripe Configuration (Server-side only)
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=

# PayU WebCheckout
PAYU_ENV=sandbox
PAYU_API_KEY=
PAYU_API_LOGIN=
PAYU_MERCHANT_ID=
PAYU_ACCOUNT_ID=
PAYU_PAYMENT_URL=https://sandbox.checkout.payulatam.com/ppp-web-gateway-payu
PAYU_RESPONSE_URL=http://localhost:3000/es/payments/payu/return
PAYU_CONFIRMATION_URL=http://localhost:3000/api/webhooks/payu
PAYU_LANGUAGE=es

# Wompi (Colombia) — see Step 6. Do not flip production to wompi until keys + COP prices are confirmed.
WOMPI_ENV=sandbox
WOMPI_PUBLIC_KEY=
WOMPI_PRIVATE_KEY=
WOMPI_EVENTS_SECRET=
WOMPI_INTEGRITY_SECRET=
NEXT_PUBLIC_WOMPI_PUBLIC_KEY=
WOMPI_REDIRECT_URL=http://localhost:3000/es/payments/wompi/return
# Wompi events URLs (configure per commerce environment — never cross-wire):
# Production: https://app.iablee.com/api/webhooks/wompi
# Sandbox:    https://<vercel-develop-or-preview-host>/api/webhooks/wompi

# Supabase Service Role Key (needed for server-side operations)
SUPABASE_SERVICE_ROLE_KEY=
```

See also root `.env.example` for the full placeholder list.

### Step 2: Run Database Migrations

Apply the new migrations to your Supabase database:

```bash
# If using Supabase CLI
supabase db push

# Or manually run the migration files in order:
# 1. supabase/migrations/20251029000000_create_billing_tables.sql
# 2. supabase/migrations/20251029000001_seed_billing_plans.sql
```

### Step 3: Configure Stripe

1. **Create Products and Prices in Stripe Dashboard**:
   - Go to Products → Add Product
   - Create products matching your plans:
     - Necessary (Monthly & Yearly)
     - Premium (Monthly & Yearly)
   - Copy the Price IDs

2. **Update Plan Price IDs**:
   Run this SQL in your Supabase SQL editor to update the provider price map:

   ```sql
   UPDATE billing_plans
   SET provider_price_map = jsonb_set(
     provider_price_map,
     '{stripe}',
     '"price_your_actual_stripe_price_id"'
   )
   WHERE id = 'plan_necessary_month';

   -- Repeat for other plans
   ```

3. **Set up Stripe Webhook**:
   - Go to Stripe Dashboard → Developers → Webhooks
   - Add endpoint: `https://your-domain.com/api/webhooks/stripe`
   - Select events to listen for:
     - `customer.subscription.created`
     - `customer.subscription.updated`
     - `customer.subscription.deleted`
     - `invoice.paid`
     - `invoice.payment_failed`
     - `payment_method.attached`
   - Copy the webhook signing secret to `STRIPE_WEBHOOK_SECRET`

### Step 4: Test the Integration

```bash
# Install Stripe CLI for local testing
stripe listen --forward-to localhost:3000/api/webhooks/stripe

# In another terminal, trigger test events
stripe trigger customer.subscription.created
```

### Step 5: Configure PayU WebCheckout (optional)

1. Update `.env.local` with the PayU variables listed above (replace the placeholder sandbox values with real credentials).
2. In the PayU dashboard, configure:
   - **Response URL**: `https://your-domain.com/payments/payu/return`
   - **Confirmation URL**: `https://your-domain.com/api/webhooks/payu`
3. Set `PAYMENT_GATEWAY=payu` and `NEXT_PUBLIC_PAYMENT_GATEWAY=payu` in `.env.local`. The checkout UI now generates a signed PayU form instead of Stripe Elements.
4. Use PayU sandbox cards to test the flow. The webhook updates `billing_subscriptions` and `billing_invoices` when the transaction state is `APPROVED`, `DECLINED`, or `PENDING`.

### Step 6: Configure Wompi Web Checkout (optional, KAN-139)

Wompi has **no native subscriptions**. iablee uses the same renew-by-checkout model as PayU:

1. User selects a plan → backend creates an incomplete subscription + open invoice keyed by a unique `reference`.
2. Browser auto-submits a **GET** form to `https://checkout.wompi.co/p/` with integrity signature.
3. Wompi redirects to `WOMPI_REDIRECT_URL?id={transaction_id}` (informational only — **do not** activate from the client).
4. Wompi POSTs `transaction.updated` to `/api/webhooks/wompi`. After checksum verification, `APPROVED` → `invoice.paid` (activates/extends the local period).

#### Env / Dashboard

1. Create sandbox keys in the Wompi Commerce Dashboard (`pub_test_`, `prv_test_`, `test_events_`, `test_integrity_`).
2. **Events URL — one per Wompi environment (required isolation):**
   - **Production commerce:** `https://app.iablee.com/api/webhooks/wompi`
   - **Sandbox commerce:** the current Vercel develop/preview deployment webhook, e.g. `https://<vercel-develop-or-preview-host>/api/webhooks/wompi` (use the live develop/preview URL from the Vercel dashboard; do not invent a hostname).
   - Local testing: `https://<tunnel>/api/webhooks/wompi` or similar.
   - **Never** point sandbox commerce at the production events URL, and **never** point production commerce at a sandbox/preview URL. Wompi requires a separate events URL per environment.
   - Commerce may be awaiting approval while production is already enabled; still keep sandbox and production isolated.
3. Fill `WOMPI_*` vars from `.env.example`. Keep `PAYMENT_GATEWAY=payu` in production until go-live.
4. **COP pricing**: plans are USD in `billing_plans.amount_cents`. Wompi charges COP only. Official COP amounts (confirmed 2026-11-13, KAN-139) come from:
   - `src/lib/billing/wompi-pricing.ts` (`WOMPI_PLAN_AMOUNT_COP_CENTS`), or
   - numeric `provider_price_map.wompi` (amount-in-cents string), via migration `supabase/migrations/20261113140000_wompi_cop_placeholder_prices.sql` (filename kept for history; prices are official)
   - Necessary monthly/yearly: `4000000` / `40000000`; Premium monthly/yearly: `8000000` / `80000000`. Migration is **not** auto-applied — run when deploying Wompi.
5. **Provider ID uniqueness (do not apply until reviewed):** migration `supabase/migrations/20261113150000_billing_provider_id_unique.sql` adds UNIQUE indexes on `billing_invoices.provider_invoice_id` and `billing_subscriptions.provider_subscription_id`. Application code uses select-then-update/insert so paid webhooks work before this lands. Next `supabase db push` would apply it.

#### Recurring follow-up (not implemented)

**Option B — Payment sources + server-side charges:** tokenize card/Nequi via acceptance token, `POST /v1/payment_sources`, later `POST /v1/transactions` with `payment_source_id` (and `recurrent=true` for Visa/MC COF). Requires a renewals job, 3RI/3DS considerations, and card/Nequi only. Documented here as follow-up; vault methods on `WompiAdapter` throw `PaymentGatewayError` like PayU.

Official docs: [Web Checkout](https://docs.wompi.co/en/docs/colombia/widget-checkout-web/), [Events](https://docs.wompi.co/en/docs/colombia/eventos/), [Transactions](https://docs.wompi.co/en/docs/colombia/transacciones/), [Payment sources](https://docs.wompi.co/docs/colombia/fuentes-de-pago/).

## Usage Examples

### Get Available Plans

```typescript
const response = await fetch('/api/billing/plans');
const { plans } = await response.json();
```

### Create a Subscription

```typescript
// First, create a payment method token on the client using Stripe Elements
// Then send it to your backend:

const response = await fetch('/api/billing/subscriptions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    planId: 'plan_necessary_month',
    paymentMethodToken: 'pm_...', // From Stripe Elements
  }),
});

const result = await response.json();
```

### Cancel a Subscription

```typescript
const response = await fetch(
  `/api/billing/subscriptions?subscriptionId=${subId}&atPeriodEnd=true`,
  { method: 'DELETE' }
);
```

## Architecture Benefits

### Provider-Agnostic Design
The system uses adapters that implement a common `PaymentGateway` interface. To add a new provider:

1. Create a new adapter (e.g., `PayPalAdapter`) implementing `PaymentGateway`
2. Create a webhook normalizer implementing `WebhookNormalizer`
3. Update `src/lib/billing/server.ts` to instantiate the new adapter
4. No changes needed to BillingService or API routes!

### Webhook Event Normalization
All provider webhooks are converted to a common format:
- `subscription.created`
- `subscription.updated`
- `subscription.canceled`
- `invoice.paid`
- `invoice.payment_failed`
- `payment_method.attached`

This means the same `BillingService.handleWebhookEvent()` method works for all providers.

### Idempotency
Webhook events are stored with unique constraints on `provider_event_id` to prevent duplicate processing.

## Next Steps (TODO)

The following features are ready to be built on top of this foundation:

### 1. UI Components (Pending)
- Plan selection page
- Billing dashboard
- Payment method management
- Invoice history view

### 2. Middleware Integration (Pending)
- Check subscription status in middleware
- Redirect to billing page if subscription expired
- Load plan features for feature gating

### 3. Feature Gating (Pending)
- Enforce asset limits based on plan
- Enforce beneficiary limits
- Check before create operations

### 4. Internationalization (Pending)
- Add billing-related translations to `messages/en.json` and `messages/es.json`:
  - Plan names and descriptions
  - Billing terms
  - Error messages
  - Payment status labels

### 5. Email Notifications (Pending)
- Payment succeeded/failed
- Subscription canceled
- Invoice issued
- Renewal reminder

## File Structure

```
src/
├── lib/
│   └── billing/
│       ├── types.ts                          # Domain types
│       ├── gateway.interface.ts              # PaymentGateway interface
│       ├── webhook-normalizer.interface.ts   # WebhookNormalizer interface
│       ├── billing.service.ts                # BillingService orchestration
│       ├── server.ts                         # Server-side utilities
│       ├── index.ts                          # Public exports
│       ├── wompi-pricing.ts                  # Official COP amounts (KAN-139)
│       └── adapters/
│           ├── stripe.adapter.ts
│           ├── stripe-webhook.normalizer.ts
│           ├── payu.adapter.ts
│           ├── payu-webhook.normalizer.ts
│           ├── wompi.adapter.ts
│           ├── wompi-webhook.normalizer.ts
│           └── index.ts
├── app/
│   └── api/
│       ├── billing/
│       │   ├── plans/route.ts
│       │   ├── subscriptions/route.ts
│       │   ├── payment-methods/route.ts
│       │   └── invoices/route.ts
│       ├── payments/wompi/transaction/route.ts
│       └── webhooks/
│           ├── stripe/route.ts
│           ├── payu/route.ts
│           └── wompi/route.ts
supabase/
└── migrations/
    ├── 20251029000000_create_billing_tables.sql
    ├── 20251029000001_seed_billing_plans.sql
    └── 20261113140000_wompi_cop_placeholder_prices.sql  # Official COP; apply when deploying Wompi
```

## Security Considerations

✅ **RLS Policies**: All billing tables have Row-Level Security enabled
✅ **User Ownership**: Users can only access their own subscriptions/invoices/payment methods
✅ **Webhook Verification**: All webhooks are verified using provider signatures
✅ **No Raw Card Data**: Only tokenized payment methods are stored
✅ **Service Role Protection**: Webhook events table is service-role only

## Troubleshooting

### Webhooks Not Working
1. Verify `STRIPE_WEBHOOK_SECRET` is set correctly
2. Check webhook endpoint is publicly accessible
3. Review webhook logs in Stripe Dashboard
4. Check server logs for verification errors

### Subscription Creation Fails
1. Verify Stripe price IDs are correctly configured in `billing_plans.provider_price_map`
2. Check that payment method token is valid
3. Ensure user has email in `users` table
4. Review Stripe Dashboard for detailed error messages

### Database Errors
1. Ensure migrations have been applied
2. Verify RLS policies are enabled
3. Check that `SUPABASE_SERVICE_ROLE_KEY` is set for server operations

## Support

For issues or questions:
1. Check the logs in your server console
2. Review Stripe Dashboard for payment-related issues
3. Check Supabase dashboard for database issues
4. Review the technical specifications in `TECHNICAL-SPECIFICATIONS.md`
