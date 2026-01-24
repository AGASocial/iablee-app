/**
 * Billing Domain Types
 * Provider-agnostic type definitions for subscription and payment management
 */

// Core billing types
export type BillingInterval = 'month' | 'year';
export type Currency = 'USD' | 'COP' | 'EUR';
export type PaymentProvider = 'stripe' | 'paypal' | 'wompi' | 'payu';

export type SubscriptionStatus =
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'incomplete'
  | 'trialing'
  | 'unpaid';

export type InvoiceStatus = 'paid' | 'open' | 'uncollectible' | 'void' | 'draft';

/**
 * Plan definition with provider-agnostic pricing and features
 */
export interface PlanDefinition {
  id: string;
  name: string;
  currency: Currency;
  amountCents: number;
  interval: BillingInterval;
  features: PlanFeatures;
  providerPriceMap?: Partial<Record<PaymentProvider, string>>;
}

/**
 * Plan features that define limits and capabilities
 * -1 indicates unlimited
 */
export interface PlanFeatures {
  max_assets: number;
  max_beneficiaries: number;
  max_file_size_mb: number;
  max_storage_mb: number;
  priority_support: boolean;
  advanced_security: boolean;
  [key: string]: number | boolean;
}

/**
 * Provider-agnostic customer reference
 */
export interface CustomerRef {
  provider: PaymentProvider;
  providerCustomerId: string;
}

/**
 * Provider-agnostic payment method token
 */
export interface PaymentMethodToken {
  provider: PaymentProvider;
  token: string;
  brand?: string;
  last4?: string;
  expMonth?: number;
  expYear?: number;
}

/**
 * Subscription data
 */
export interface Subscription {
  id: string;
  userId: string;
  planId: string;
  status: SubscriptionStatus;
  provider: PaymentProvider;
  providerSubscriptionId: string;
  providerCustomerId?: string;
  currentPeriodStart?: Date;
  currentPeriodEnd?: Date;
  cancelAtPeriodEnd: boolean;
  canceledAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Invoice data
 */
export interface Invoice {
  id: string;
  userId: string;
  subscriptionId?: string;
  provider: PaymentProvider;
  providerInvoiceId: string;
  amountCents: number;
  currency: Currency;
  status: InvoiceStatus;
  issuedAt: Date;
  paidAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Payment method data
 */
export interface PaymentMethod {
  id: string;
  userId: string;
  provider: PaymentProvider;
  providerCustomerId: string;
  token: string;
  type: string; // Payment method type (e.g., 'card')
  // Nested card object for UI compatibility
  card?: {
    brand: string;
    last4: string;
    expMonth: number;
    expYear: number;
  };
  // Flat properties for backward compatibility
  brand?: string;
  last4?: string;
  expMonth?: number;
  expYear?: number;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Normalized webhook event types
 */
export type NormalizedEventType =
  | 'subscription.created'
  | 'subscription.updated'
  | 'subscription.canceled'
  | 'invoice.paid'
  | 'invoice.payment_failed'
  | 'payment_method.attached'
  | 'payment_method.detached'
  | 'customer.created'
  | 'customer.updated';

/**
 * Normalized webhook event
 */
export interface NormalizedEvent<T = unknown> {
  id: string;
  type: NormalizedEventType;
  occurredAt: string;
  provider: PaymentProvider;
  raw: unknown;
  data: T;
}

/**
 * Event data payloads
 */
export interface SubscriptionEventData {
  userId?: string;
  subscriptionId: string;
  customerId: string;
  planId?: string;
  status: SubscriptionStatus;
  currentPeriodStart?: string;
  currentPeriodEnd?: string;
  cancelAtPeriodEnd?: boolean;
  canceledAt?: string;
}

export interface InvoiceEventData {
  invoiceId: string;
  customerId: string;
  subscriptionId?: string;
  amountCents: number;
  currency: Currency;
  status: InvoiceStatus;
  issuedAt: string;
  paidAt?: string;
  userId?: string;
  planId?: string;
  rawStatus?: string;
}

export interface PaymentMethodEventData {
  customerId: string;
  paymentMethodId: string;
  brand?: string;
  last4?: string;
  expMonth?: number;
  expYear?: number;
}

export interface CustomerEventData {
  customerId: string;
  email: string;
  name?: string;
}

/**
 * Request/Response types for billing operations
 */
export interface CreateSubscriptionRequest {
  userId: string;
  planId: string;
  paymentMethodToken?: string;
}

export interface CreateSubscriptionResponse {
  subscriptionId: string;
  providerSubscriptionId: string;
  status: SubscriptionStatus;
  clientSecret?: string; // For confirmation flows (like Stripe)
  checkoutSession?: CheckoutSessionDetails;
}

export interface CheckoutSessionDetails {
  provider: PaymentProvider;
  sessionId: string;
  url: string;
  formFields?: Record<string, string>;
}

export interface UpdateSubscriptionRequest {
  subscriptionId: string;
  planId?: string;
  cancelAtPeriodEnd?: boolean;
}

export interface CancelSubscriptionRequest {
  subscriptionId: string;
  atPeriodEnd?: boolean;
}

export interface AttachPaymentMethodRequest {
  userId: string;
  paymentMethodToken: string;
  setAsDefault?: boolean;
}

export interface AttachPaymentMethodResponse {
  paymentMethodId: string;
  brand?: string;
  last4?: string;
}

/**
 * Billing service errors
 */
export class BillingError extends Error {
  constructor(
    message: string,
    public code: string,
    public provider?: PaymentProvider
  ) {
    super(message);
    this.name = 'BillingError';
  }
}

export class PaymentGatewayError extends BillingError {
  constructor(message: string, provider: PaymentProvider, code = 'GATEWAY_ERROR') {
    super(message, code, provider);
    this.name = 'PaymentGatewayError';
  }
}

export class WebhookVerificationError extends BillingError {
  constructor(message: string, provider: PaymentProvider) {
    super(message, 'WEBHOOK_VERIFICATION_FAILED', provider);
    this.name = 'WebhookVerificationError';
  }
}

export class SubscriptionNotFoundError extends BillingError {
  constructor(subscriptionId: string) {
    super(`Subscription not found: ${subscriptionId}`, 'SUBSCRIPTION_NOT_FOUND');
    this.name = 'SubscriptionNotFoundError';
  }
}

export class PlanNotFoundError extends BillingError {
  constructor(planId: string) {
    super(`Plan not found: ${planId}`, 'PLAN_NOT_FOUND');
    this.name = 'PlanNotFoundError';
  }
}
