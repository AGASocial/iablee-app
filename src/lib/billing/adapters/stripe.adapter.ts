/**
 * Stripe Adapter
 * Implementation of PaymentGateway interface for Stripe
 */

import Stripe from 'stripe';
import type {
  PaymentGateway,
  CreateCustomerParams,
  CreateSubscriptionParams,
  SubscriptionResult,
  InvoiceData,
} from '../gateway.interface';
import type {
  CustomerRef,
  PaymentMethodToken,
  PaymentProvider,
} from '../types';

export class StripeAdapter implements PaymentGateway {
  private stripe: Stripe;

  constructor(secretKey: string) {
    if (!secretKey) {
      throw new Error('Stripe secret key is required');
    }

    this.stripe = new Stripe(secretKey, {
      apiVersion: '2025-09-30.clover',
      typescript: true,
    });
  }

  getName(): PaymentProvider {
    return 'stripe';
  }

  async createCustomer(params: CreateCustomerParams): Promise<CustomerRef> {
    try {
      const customer = await this.stripe.customers.create({
        email: params.email,
        name: params.name,
        metadata: {
          ...params.metadata,
          user_id: params.userId,
        },
      });

      return {
        provider: 'stripe',
        providerCustomerId: customer.id,
      };
    } catch (error) {
      throw this.handleStripeError(error, 'Failed to create customer');
    }
  }

  async getOrCreateCustomer(params: CreateCustomerParams): Promise<CustomerRef> {
    try {
      // Search for existing customer by email
      const customers = await this.stripe.customers.list({
        email: params.email,
        limit: 1,
      });

      if (customers.data.length > 0) {
        return {
          provider: 'stripe',
          providerCustomerId: customers.data[0].id,
        };
      }

      // Create new customer if not found
      return await this.createCustomer(params);
    } catch (error) {
      throw this.handleStripeError(error, 'Failed to get or create customer');
    }
  }

  async attachPaymentMethod(
    customer: CustomerRef,
    method: PaymentMethodToken
  ): Promise<PaymentMethodToken> {
    try {
      // Attach payment method to customer
      const paymentMethod = await this.stripe.paymentMethods.attach(method.token, {
        customer: customer.providerCustomerId,
      });

      return {
        provider: 'stripe',
        token: paymentMethod.id,
        brand: paymentMethod.card?.brand,
        last4: paymentMethod.card?.last4,
        expMonth: paymentMethod.card?.exp_month,
        expYear: paymentMethod.card?.exp_year,
      };
    } catch (error) {
      throw this.handleStripeError(error, 'Failed to attach payment method');
    }
  }

  async setDefaultPaymentMethod(
    customer: CustomerRef,
    paymentMethodId: string
  ): Promise<void> {
    try {
      await this.stripe.customers.update(customer.providerCustomerId, {
        invoice_settings: {
          default_payment_method: paymentMethodId,
        },
      });
    } catch (error) {
      throw this.handleStripeError(error, 'Failed to set default payment method');
    }
  }

  async detachPaymentMethod(paymentMethodId: string): Promise<void> {
    try {
      await this.stripe.paymentMethods.detach(paymentMethodId);
    } catch (error) {
      throw this.handleStripeError(error, 'Failed to detach payment method');
    }
  }

  async createSubscription(
    params: CreateSubscriptionParams
  ): Promise<SubscriptionResult> {
    try {
      const { customer, plan, paymentMethod, trialDays, metadata } = params;

      // Get price ID from plan's provider price map
      const priceId = plan.providerPriceMap?.stripe;
      if (!priceId) {
        throw new Error('Stripe price ID not configured for this plan');
      }

      const subscriptionParams: Stripe.SubscriptionCreateParams = {
        customer: customer.providerCustomerId,
        items: [{ price: priceId }],
        metadata: metadata || {},
        payment_behavior: 'default_incomplete',
        payment_settings: { save_default_payment_method: 'on_subscription' },
        expand: ['latest_invoice.payment_intent'],
      };

      // Add default payment method if provided
      if (paymentMethod) {
        subscriptionParams.default_payment_method = paymentMethod.token;
      }

      // Add trial period if specified
      if (trialDays) {
        subscriptionParams.trial_period_days = trialDays;
      }

      const subscription = await this.stripe.subscriptions.create(subscriptionParams);

      // Extract client secret for confirmation
      let clientSecret: string | undefined;
      const subData = subscription as unknown as Record<string, unknown>;
      const latestInvoice = subData.latest_invoice || subData.latestInvoice;
      if (latestInvoice && typeof latestInvoice !== 'string') {
        const invoiceData = latestInvoice as Record<string, unknown>;
        const paymentIntent = invoiceData.payment_intent || invoiceData.paymentIntent;
        if (paymentIntent && typeof paymentIntent !== 'string') {
          const piData = paymentIntent as Record<string, unknown>;
          clientSecret = (piData.client_secret || piData.clientSecret) as string | undefined;
        }
      }

      // Access period end via the data record to handle snake_case properties
      const periodEnd = (subData.current_period_end as number) || (subData.currentPeriodEnd as number) || Date.now() / 1000;

      return {
        providerSubscriptionId: subscription.id,
        status: subscription.status,
        currentPeriodEnd: new Date(periodEnd * 1000),
        clientSecret,
      };
    } catch (error) {
      throw this.handleStripeError(error, 'Failed to create subscription');
    }
  }

  async updateSubscription(
    providerSubscriptionId: string,
    params: { planId?: string; cancelAtPeriodEnd?: boolean }
  ): Promise<SubscriptionResult> {
    try {
      const updateParams: Stripe.SubscriptionUpdateParams = {};

      // Update plan if provided
      if (params.planId) {
        // Note: planId here should be the Stripe price ID
        updateParams.items = [
          {
            id: (await this.stripe.subscriptions.retrieve(providerSubscriptionId)).items
              .data[0].id,
            price: params.planId,
          },
        ];
      }

      // Update cancel at period end if provided
      if (params.cancelAtPeriodEnd !== undefined) {
        updateParams.cancel_at_period_end = params.cancelAtPeriodEnd;
      }

      const subscription = await this.stripe.subscriptions.update(
        providerSubscriptionId,
        updateParams
      );

      const subData = subscription as unknown as Record<string, unknown>;
      const periodEnd = (subData.current_period_end as number) || (subData.currentPeriodEnd as number) || Date.now() / 1000;

      return {
        providerSubscriptionId: subscription.id,
        status: subscription.status,
        currentPeriodEnd: new Date(periodEnd * 1000),
      };
    } catch (error) {
      throw this.handleStripeError(error, 'Failed to update subscription');
    }
  }

  async cancelSubscription(
    providerSubscriptionId: string,
    atPeriodEnd = true
  ): Promise<void> {
    try {
      if (atPeriodEnd) {
        await this.stripe.subscriptions.update(providerSubscriptionId, {
          cancel_at_period_end: true,
        });
      } else {
        await this.stripe.subscriptions.cancel(providerSubscriptionId);
      }
    } catch (error) {
      throw this.handleStripeError(error, 'Failed to cancel subscription');
    }
  }

  async reactivateSubscription(
    providerSubscriptionId: string
  ): Promise<SubscriptionResult> {
    try {
      const subscription = await this.stripe.subscriptions.update(providerSubscriptionId, {
        cancel_at_period_end: false,
      });

      const subData = subscription as unknown as Record<string, unknown>;
      const periodEnd = (subData.current_period_end as number) || (subData.currentPeriodEnd as number) || Date.now() / 1000;

      return {
        providerSubscriptionId: subscription.id,
        status: subscription.status,
        currentPeriodEnd: new Date(periodEnd * 1000),
      };
    } catch (error) {
      throw this.handleStripeError(error, 'Failed to reactivate subscription');
    }
  }

  async getInvoices(customer: CustomerRef, limit = 10): Promise<InvoiceData[]> {
    try {
      const invoices = await this.stripe.invoices.list({
        customer: customer.providerCustomerId,
        limit,
      });

      return invoices.data.map((invoice) => {
        const invData = invoice as unknown as Record<string, unknown>;
        const statusTrans = (invData.status_transitions || invData.statusTransitions) as Record<string, unknown> | undefined;
        return {
          id: invoice.id,
          amountCents: (invData.amount_paid as number) || 0,
          currency: invoice.currency.toUpperCase() as InvoiceData['currency'],
          status: this.mapInvoiceStatus(invoice.status),
          createdAt: new Date(invoice.created * 1000).toISOString(),
          paidAt: statusTrans?.paid_at
            ? new Date((statusTrans.paid_at as number) * 1000).toISOString()
            : undefined,
        };
      });
    } catch (error) {
      throw this.handleStripeError(error, 'Failed to fetch invoices');
    }
  }

  async getInvoice(providerInvoiceId: string): Promise<InvoiceData> {
    try {
      const invoice = await this.stripe.invoices.retrieve(providerInvoiceId);

      const invData = invoice as unknown as Record<string, unknown>;
      const statusTrans = (invData.status_transitions || invData.statusTransitions) as Record<string, unknown> | undefined;
      return {
        id: invoice.id,
        amountCents: (invData.amount_paid as number) || 0,
        currency: invoice.currency.toUpperCase() as InvoiceData['currency'],
        status: this.mapInvoiceStatus(invoice.status),
        createdAt: new Date(invoice.created * 1000).toISOString(),
        paidAt: statusTrans?.paid_at
          ? new Date((statusTrans.paid_at as number) * 1000).toISOString()
          : undefined,
      };
    } catch (error) {
      throw this.handleStripeError(error, 'Failed to fetch invoice');
    }
  }

  async retryInvoicePayment(providerInvoiceId: string): Promise<InvoiceData> {
    try {
      const invoice = await this.stripe.invoices.pay(providerInvoiceId);
      const invData = invoice as unknown as Record<string, unknown>;
      const statusTrans = (invData.status_transitions || invData.statusTransitions) as Record<string, unknown> | undefined;

      return {
        id: invoice.id,
        amountCents: (invData.amount_paid as number) || 0,
        currency: invoice.currency.toUpperCase() as InvoiceData['currency'],
        status: this.mapInvoiceStatus(invoice.status),
        createdAt: new Date(invoice.created * 1000).toISOString(),
        paidAt: statusTrans?.paid_at
          ? new Date((statusTrans.paid_at as number) * 1000).toISOString()
          : undefined,
      };
    } catch (error) {
      throw this.handleStripeError(error, 'Failed to retry invoice payment');
    }
  }

  async createCheckoutSession(params: {
    customer?: CustomerRef;
    plan: { providerPriceMap?: Partial<Record<PaymentProvider, string>> };
    successUrl: string;
    cancelUrl: string;
    metadata?: Record<string, string>;
  }): Promise<{ sessionId: string; url: string }> {
    try {
      const { customer, plan, successUrl, cancelUrl, metadata } = params;

      const priceId = plan.providerPriceMap?.stripe;
      if (!priceId) {
        throw new Error('Stripe price ID not configured for this plan');
      }

      const sessionParams: Stripe.Checkout.SessionCreateParams = {
        mode: 'subscription',
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: metadata || {},
      };

      if (customer) {
        sessionParams.customer = customer.providerCustomerId;
      }

      const session = await this.stripe.checkout.sessions.create(sessionParams);

      if (!session.url) {
        throw new Error('Checkout session URL not available');
      }

      return {
        sessionId: session.id,
        url: session.url,
      };
    } catch (error) {
      throw this.handleStripeError(error, 'Failed to create checkout session');
    }
  }

  async createPortalSession(params: {
    customer: CustomerRef;
    returnUrl: string;
  }): Promise<{ url: string }> {
    try {
      const session = await this.stripe.billingPortal.sessions.create({
        customer: params.customer.providerCustomerId,
        return_url: params.returnUrl,
      });

      return {
        url: session.url,
      };
    } catch (error) {
      throw this.handleStripeError(error, 'Failed to create portal session');
    }
  }

  /**
   * Map Stripe invoice status to our domain status
   */
  private mapInvoiceStatus(
    stripeStatus: Stripe.Invoice.Status | null
  ): 'paid' | 'open' | 'uncollectible' | 'void' | 'draft' {
    switch (stripeStatus) {
      case 'paid':
        return 'paid';
      case 'open':
        return 'open';
      case 'uncollectible':
        return 'uncollectible';
      case 'void':
        return 'void';
      case 'draft':
        return 'draft';
      default:
        return 'draft';
    }
  }

  /**
   * Handle Stripe errors and convert to domain errors
   */
  private handleStripeError(error: unknown, defaultMessage: string): Error {
    if (error instanceof Stripe.errors.StripeError) {
      const message = error.message || defaultMessage;
      return new Error(`${defaultMessage}: ${message}`);
    }

    if (error instanceof Error) {
      return error;
    }

    return new Error(defaultMessage);
  }
}
