/**
 * Payment Gateway Interface
 * Provider-agnostic interface for payment operations
 */

import type {
  CustomerRef,
  PaymentMethodToken,
  PlanDefinition,
  PaymentProvider,
  Currency,
  InvoiceStatus,
} from './types';

/**
 * Parameters for creating a customer
 */
export interface CreateCustomerParams {
  userId: string;
  email: string;
  name?: string;
  metadata?: Record<string, string>;
}

/**
 * Parameters for creating a subscription
 */
export interface CreateSubscriptionParams {
  customer: CustomerRef;
  plan: PlanDefinition;
  paymentMethod?: PaymentMethodToken;
  trialDays?: number;
  metadata?: Record<string, string>;
}

/**
 * Subscription creation result
 */
export interface SubscriptionResult {
  providerSubscriptionId: string;
  status: string;
  currentPeriodEnd?: Date;
  clientSecret?: string; // For payment confirmation (Stripe)
}

/**
 * Invoice data from provider
 */
export interface InvoiceData {
  id: string;
  amountCents: number;
  currency: Currency;
  status: InvoiceStatus;
  createdAt: string;
  paidAt?: string;
}

/**
 * Payment Gateway Interface
 * All payment providers must implement this interface
 */
export interface PaymentGateway {
  /**
   * Get the provider name
   */
  getName(): PaymentProvider;

  /**
   * Create a customer in the payment provider
   */
  createCustomer(params: CreateCustomerParams): Promise<CustomerRef>;

  /**
   * Get or create a customer (idempotent)
   */
  getOrCreateCustomer(params: CreateCustomerParams): Promise<CustomerRef>;

  /**
   * Attach a payment method to a customer
   */
  attachPaymentMethod(
    customer: CustomerRef,
    method: PaymentMethodToken
  ): Promise<PaymentMethodToken>;

  /**
   * Set a payment method as the default for a customer
   */
  setDefaultPaymentMethod(
    customer: CustomerRef,
    paymentMethodId: string
  ): Promise<void>;

  /**
   * Detach/remove a payment method from a customer
   */
  detachPaymentMethod(paymentMethodId: string): Promise<void>;

  /**
   * Create a subscription for a customer
   */
  createSubscription(params: CreateSubscriptionParams): Promise<SubscriptionResult>;

  /**
   * Update a subscription (change plan, etc.)
   */
  updateSubscription(
    providerSubscriptionId: string,
    params: {
      planId?: string;
      cancelAtPeriodEnd?: boolean;
    }
  ): Promise<SubscriptionResult>;

  /**
   * Cancel a subscription
   */
  cancelSubscription(
    providerSubscriptionId: string,
    atPeriodEnd?: boolean
  ): Promise<void>;

  /**
   * Reactivate a canceled subscription (if still in current period)
   */
  reactivateSubscription(providerSubscriptionId: string): Promise<SubscriptionResult>;

  /**
   * Get invoices for a customer
   */
  getInvoices(customer: CustomerRef, limit?: number): Promise<InvoiceData[]>;

  /**
   * Get a specific invoice
   */
  getInvoice(providerInvoiceId: string): Promise<InvoiceData>;

  /**
   * Retry a failed payment for an invoice
   */
  retryInvoicePayment?(providerInvoiceId: string): Promise<InvoiceData>;

  /**
   * Create a checkout session (for hosted payment pages)
   * Optional - not all providers support this
   */
  createCheckoutSession?(params: {
    customer?: CustomerRef;
    plan: PlanDefinition;
    successUrl: string;
    cancelUrl: string;
    metadata?: Record<string, string>;
  }): Promise<{
    sessionId: string;
    url: string;
  }>;

  /**
   * Create a portal session (for customer self-service)
   * Optional - not all providers support this
   */
  createPortalSession?(params: {
    customer: CustomerRef;
    returnUrl: string;
  }): Promise<{
    url: string;
  }>;
}
