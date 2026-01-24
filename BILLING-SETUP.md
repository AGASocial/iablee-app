# Callback URL
http://localhost:3000/en/payments/payu/return?merchantId=508029&merchant_name=Test+PayU&merchant_address=Av+123+Calle+12&telephone=7512354&merchant_url=http%3A%2F%2Fpruebaslapv.xtrweb.com&transactionState=4&lapTransactionState=APPROVED&message=APPROVED&referenceCode=payu_48508890-08ea-40bc-8dc6-4a0860f6bc6a_1769218748365&reference_pol=2156386850&transactionId=cc22397e-6cd6-4c58-9157-a4ab28b7c490&description=Premium&trazabilityCode=102038074500&cus=102038074500&orderLanguage=es&extra1=48508890-08ea-40bc-8dc6-4a0860f6bc6a&extra2=plan_premium_month&extra3=&polTransactionState=4&signature=84bb03c751a39677aae937dd7220494a&polResponseCode=1&lapResponseCode=APPROVED&risk=&polPaymentMethod=1074&lapPaymentMethod=MASTERCARD&polPaymentMethodType=2&lapPaymentMethodType=CREDIT_CARD&installmentsNumber=1&TX_VALUE=19.99&TX_TAX=.00&currency=USD&lng=es&pseCycle=&buyerEmail=gaveho%40gmail.com&pseBank=&pseReference1=&pseReference2=&pseReference3=&authorizationCode=654321&authorizationCode=654321&khipuBank=&TX_ADMINISTRATIVE_FEE=.00&TX_TAX_ADMINISTRATIVE_FEE=.00&TX_TAX_ADMINISTRATIVE_FEE_RETURN_BASE=.00&processingDate=2026-01-23

# Billing & Subscription System - Setup Guide

This document provides a comprehensive guide for the newly implemented billing and subscription system.

## Overview

The billing system is **provider-agnostic** and currently supports Stripe, with the architecture designed to easily add PayPal, Wompi, or PayU in the future.

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

### 5. Database Types ✅
- Updated `src/lib/supabase.ts` with all billing table types

## Setup Instructions

### Step 1: Environment Variables

Add the following to your `.env.local`:

```bash
# Payment Gateway Configuration
PAYMENT_GATEWAY=stripe  # Set to 'payu' to use PayU WebCheckout
NEXT_PUBLIC_PAYMENT_GATEWAY=stripe # Client-side hint for rendering the correct UI

# Stripe Configuration (Server-side only)
STRIPE_SECRET_KEY=sk_test_...  # Your Stripe secret key
STRIPE_WEBHOOK_SECRET=whsec_...  # Your Stripe webhook signing secret

# PayU WebCheckout (example sandbox credentials)
PAYU_ENV=sandbox
PAYU_API_KEY=p4yu_s4ndb0x_k3y
PAYU_API_LOGIN=p4yu_s4ndb0x_l0gin
PAYU_MERCHANT_ID=508029
PAYU_ACCOUNT_ID=512321
PAYU_PAYMENT_URL=https://sandbox.checkout.payulatam.com/ppp-web-gateway-payu
PAYU_RESPONSE_URL=https://example.com/payments/payu/return
PAYU_CONFIRMATION_URL=https://example.com/api/webhooks/payu
PAYU_LANGUAGE=es

# Supabase Service Role Key (needed for server-side operations)
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

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
│       └── adapters/
│           ├── stripe.adapter.ts             # Stripe implementation
│           ├── stripe-webhook.normalizer.ts  # Stripe webhook normalizer
│           └── index.ts
├── app/
│   └── api/
│       ├── billing/
│       │   ├── plans/route.ts                # GET plans
│       │   ├── subscriptions/route.ts        # CRUD subscriptions
│       │   ├── payment-methods/route.ts      # CRUD payment methods
│       │   └── invoices/route.ts             # GET invoices
│       └── webhooks/
│           └── stripe/route.ts               # Stripe webhook handler
supabase/
└── migrations/
    ├── 20251029000000_create_billing_tables.sql
    └── 20251029000001_seed_billing_plans.sql
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
