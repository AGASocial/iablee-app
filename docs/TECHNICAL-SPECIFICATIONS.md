### Subscription & Payments - Technical Specifications (Provider-Agnostic)

This document defines a provider-agnostic subscription billing solution that can work with Stripe, PayPal, Wompi, or PayU with minimal switching cost.

### Goals

- Decouple business logic from payment providers via clear interfaces and adapters.
- Support monthly and yearly recurring plans; store a reusable payment method token.
- Normalize webhook events to a common domain model.
- Enforce plan limits and access through middleware/feature gating.
- Maintain security via Supabase RLS and secure token handling.

### High-Level Architecture

- Domain Layer (provider-agnostic):
  - PaymentGateway interface: create customer, attach payment method, create/cancel subscription, fetch invoices, handle checkout sessions (when applicable).
  - WebhookNormalizer: convert provider-specific events into normalized events (SubscriptionCreated, PaymentSucceeded, PaymentFailed, SubscriptionCanceled, InvoicePaid, InvoicePaymentFailed, ChargeDispute, etc.).
  - BillingService: orchestrates domain operations, persists state to DB, emits notifications, and triggers feature gating updates.

- Provider Adapters (provider-specific):
  - StripeAdapter, PayPalAdapter, WompiAdapter, PayUAdapter implement PaymentGateway.
  - Webhook parsers per provider returning NormalizedEvent.

- Storage:
  - Supabase tables for plans, subscriptions, payment_methods, invoices, webhook_events.
  - All tables protected with RLS to the owning user where applicable; provider keys are never stored client-side.

### Provider-Agnostic Interfaces (TypeScript design)

```ts
// Domain entities
type BillingInterval = 'month' | 'year'
type Currency = 'USD' | 'COP' | 'EUR' // extend as needed

interface PlanDefinition {
  id: string // internal plan id (e.g., "plan_necessary_month")
  providerPriceMap?: Record<'stripe' | 'paypal' | 'wompi' | 'payu', string> // provider price/plan IDs
  name: string
  currency: Currency
  amountCents: number
  interval: BillingInterval
  features: Record<string, number | boolean>
}

// Gateway-agnostic tokens
interface CustomerRef { provider: string; providerCustomerId: string }
interface PaymentMethodToken { provider: string; token: string; brand?: string; last4?: string; expMonth?: number; expYear?: number }

// Normalized webhook events
type NormalizedEventType =
  | 'subscription.created'
  | 'subscription.updated'
  | 'subscription.canceled'
  | 'invoice.paid'
  | 'invoice.payment_failed'
  | 'payment_method.attached'

interface NormalizedEvent<T = unknown> {
  id: string
  type: NormalizedEventType
  occurredAt: string
  provider: string
  raw: unknown
  data: T
}

// Payment provider interface
interface PaymentGateway {
  getName(): 'stripe' | 'paypal' | 'wompi' | 'payu'
  createCustomer(params: { email: string; name?: string }): Promise<CustomerRef>
  attachPaymentMethod(customer: CustomerRef, method: PaymentMethodToken): Promise<PaymentMethodToken>
  createSubscription(params: { customer: CustomerRef; plan: PlanDefinition; paymentMethod?: PaymentMethodToken }): Promise<{ providerSubscriptionId: string; status: string }>
  cancelSubscription(providerSubscriptionId: string, atPeriodEnd?: boolean): Promise<void>
  getInvoices(customer: CustomerRef, limit?: number): Promise<Array<{ id: string; amountCents: number; currency: Currency; status: string; createdAt: string }>>
}

interface WebhookNormalizer {
  provider(): PaymentGateway['getName']
  normalize(raw: unknown, headers: Record<string, string>): NormalizedEvent | null
}
```

### Switching Providers

- The app selects an adapter at runtime via configuration (e.g., `PAYMENT_GATEWAY=stripe|paypal|wompi|payu`).
- Provider-specific IDs are kept in `PlanDefinition.providerPriceMap` to map internal plans to external products/prices.
- Webhooks are routed to a single endpoint per provider (e.g., `/api/webhooks/{provider}`) and normalized before processing.

### Database Schema (Supabase)

New tables (namespaced in `public`):

- `billing_plans`
  - `id` (text, pk) — internal plan id
  - `name` (text)
  - `currency` (text)
  - `amount_cents` (int)
  - `interval` (text: 'month'|'year')
  - `features` (jsonb) — e.g., { max_assets: 100, max_beneficiaries: 6 }
  - `provider_price_map` (jsonb) — { stripe: 'price_...', paypal: '...', wompi: '...', payu: '...' }

- `billing_subscriptions`
  - `id` (uuid, pk, default gen_random_uuid())
  - `user_id` (uuid, fk → users.id)
  - `plan_id` (text, fk → billing_plans.id)
  - `status` (text) — active, past_due, canceled, incomplete
  - `provider` (text)
  - `provider_subscription_id` (text)
  - `current_period_end` (timestamptz)
  - `cancel_at_period_end` (boolean)
  - `created_at`, `updated_at` (timestamptz)

- `billing_payment_methods`
  - `id` (uuid, pk)
  - `user_id` (uuid, fk → users.id)
  - `provider` (text)
  - `provider_customer_id` (text)
  - `token` (text) — opaque token/pm id from provider
  - `brand`, `last4`, `exp_month`, `exp_year` (nullable)
  - `is_default` (boolean)
  - `created_at`, `updated_at` (timestamptz)

- `billing_invoices`
  - `id` (uuid, pk)
  - `user_id` (uuid, fk → users.id)
  - `provider` (text)
  - `provider_invoice_id` (text)
  - `amount_cents` (int)
  - `currency` (text)
  - `status` (text) — paid, open, uncollectible, void
  - `issued_at` (timestamptz)

- `billing_webhook_events`
  - `id` (uuid, pk)
  - `provider` (text)
  - `type` (text)
  - `raw` (jsonb)
  - `received_at` (timestamptz default now())
  - `handled` (boolean default false)

RLS policies:

- `billing_plans`: read-only for all authenticated users; write by service role only (no direct client insert/update).
- `billing_subscriptions`, `billing_payment_methods`, `billing_invoices`: user can `SELECT`/`INSERT`/`UPDATE` only where `auth.uid() = user_id`.
- `billing_webhook_events`: not exposed to client; service role only.

### API Endpoints (Next.js App Routes)

- `POST /api/billing/payment-methods` — attach/set default payment method (calls `PaymentGateway.attachPaymentMethod`).
- `POST /api/billing/subscriptions` — create subscription to a plan; accepts plan id and optional payment method token.
- `PATCH /api/billing/subscriptions/:id` — update (change plan, set cancel_at_period_end).
- `DELETE /api/billing/subscriptions/:id` — cancel subscription.
- `GET /api/billing/invoices` — list invoices for the user.
- `POST /api/webhooks/:provider` — receive provider webhooks; verify signature, normalize, record event, hand off to BillingService.

All endpoints require a session; server-side verifies `auth.uid()` matches `user_id` for affected records.

### Core Flows

1) Plan selection + subscribe
   - User selects plan → backend maps to provider price id → `PaymentGateway.createSubscription` → persist subscription row → return status.

2) Add/Update payment method
   - UI collects provider token via provider UI (e.g., Stripe Elements, PayPal vaulting, Wompi tokenization) → send token to server → store token meta in `billing_payment_methods` → set default method.

3) Webhook handling
   - Endpoint verifies signature per provider → `WebhookNormalizer.normalize` → store in `billing_webhook_events` → idempotently update `billing_subscriptions`/`billing_invoices` → trigger emails/notifications.

4) Enforcement (feature gating)
   - Middleware reads subscription status; if inactive/past_due, redirect to billing page.
   - Plan features loaded from `billing_plans.features` control limits (e.g., max assets/beneficiaries).

### Feature Gating Strategy

- Load current `billing_subscriptions.plan_id` and join `billing_plans.features`.
- Before create operations (assets/beneficiaries/files), enforce limits in API routes and surface friendly messages.

### Internationalization

- Add keys for billing terms, error messages, and plan descriptions to `messages/en.json` and `messages/es.json` (lowercase hyphen-separated keys).

### Notifications

- Email templates for: payment succeeded/failed, invoice issued, subscription canceled, trial ending (if added), renewal reminder.

### Testing Strategy

- Unit tests: BillingService, adapters (mock provider SDK), webhook normalizers.
- Integration tests: End-to-end subscribe/cancel flows with provider sandbox.
- Idempotency: Protect webhook processing with unique event storage and transactional updates.

### Security Considerations

- Do not store raw card data; only provider tokens.
- Validate webhook signatures and keep provider secrets server-side only.
- Enforce RLS and verify `auth.uid()` on all mutations.

### Migration Plan

1) Add migrations for `billing_*` tables and RLS policies.
2) Seed `billing_plans` with initial tiers (monthly/yearly) and feature limits.
3) Implement one provider adapter first (e.g., Stripe), keep interfaces stable.
4) Add webhook endpoint + normalizer.
5) Build UI (plan selection, billing dashboard, payment methods).
6) Add middleware checks + feature gating.
7) Expand to additional providers by adding new adapters.

### Configuration

- `PAYMENT_GATEWAY` = `stripe` | `paypal` | `wompi` | `payu`
- Provider-specific keys (all server-side):
  - Stripe: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
  - PayPal: `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`
  - Wompi: `WOMPI_PUBLIC_KEY`, `WOMPI_PRIVATE_KEY`, `WOMPI_WEBHOOK_SECRET`
  - PayU: `PAYU_API_LOGIN`, `PAYU_API_KEY`, `PAYU_WEBHOOK_SECRET`


