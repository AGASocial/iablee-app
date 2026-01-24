/**
 * Stripe Webhook Normalizer
 * Converts Stripe webhook events into normalized domain events
 */

import Stripe from 'stripe';
import type { WebhookNormalizer, WebhookVerificationResult } from '../webhook-normalizer.interface';
import type {
  NormalizedEvent,
  PaymentProvider,
  SubscriptionEventData,
  InvoiceEventData,
  PaymentMethodEventData,
  CustomerEventData,
} from '../types';

export class StripeWebhookNormalizer implements WebhookNormalizer {
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

  provider(): PaymentProvider {
    return 'stripe';
  }

  async verify(
    payload: string | object,
    headers: Record<string, string | string[] | undefined>,
    secret: string
  ): Promise<WebhookVerificationResult> {
    try {
      const signature = headers['stripe-signature'];
      if (!signature || typeof signature !== 'string') {
        return {
          verified: false,
          error: 'Missing stripe-signature header',
        };
      }

      const payloadString = typeof payload === 'string' ? payload : JSON.stringify(payload);

      const event = this.stripe.webhooks.constructEvent(payloadString, signature, secret);

      return {
        verified: true,
        event,
      };
    } catch (error) {
      return {
        verified: false,
        error: error instanceof Error ? error.message : 'Webhook verification failed',
      };
    }
  }

  normalize(raw: unknown): NormalizedEvent | null {
    if (!this.isStripeEvent(raw)) {
      return null;
    }

    const event = raw as Stripe.Event;

    if (!this.shouldProcess(event.type)) {
      return null;
    }

    try {
      const normalizedEvent: NormalizedEvent = {
        id: event.id,
        type: this.mapEventType(event.type),
        occurredAt: new Date(event.created * 1000).toISOString(),
        provider: 'stripe',
        raw: event,
        data: this.extractEventData(event),
      };

      return normalizedEvent;
    } catch (error) {
      console.error('Failed to normalize Stripe event:', error);
      return null;
    }
  }

  shouldProcess(eventType: string): boolean {
    const supportedEvents = [
      'customer.subscription.created',
      'customer.subscription.updated',
      'customer.subscription.deleted',
      'invoice.paid',
      'invoice.payment_failed',
      'payment_method.attached',
      'payment_method.detached',
      'customer.created',
      'customer.updated',
    ];

    return supportedEvents.includes(eventType);
  }

  getEventId(raw: unknown): string | null {
    if (this.isStripeEvent(raw)) {
      return (raw as Stripe.Event).id;
    }
    return null;
  }

  /**
   * Map Stripe event type to normalized event type
   */
  private mapEventType(stripeEventType: string): NormalizedEvent['type'] {
    const typeMap: Record<string, NormalizedEvent['type']> = {
      'customer.subscription.created': 'subscription.created',
      'customer.subscription.updated': 'subscription.updated',
      'customer.subscription.deleted': 'subscription.canceled',
      'invoice.paid': 'invoice.paid',
      'invoice.payment_failed': 'invoice.payment_failed',
      'payment_method.attached': 'payment_method.attached',
      'payment_method.detached': 'payment_method.detached',
      'customer.created': 'customer.created',
      'customer.updated': 'customer.updated',
    };

    return typeMap[stripeEventType] || ('subscription.updated' as NormalizedEvent['type']);
  }

  /**
   * Extract relevant data from Stripe event
   */
  private extractEventData(event: Stripe.Event): unknown {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        return this.extractSubscriptionData(event.data.object as Stripe.Subscription);

      case 'invoice.paid':
      case 'invoice.payment_failed':
        return this.extractInvoiceData(event.data.object as Stripe.Invoice);

      case 'payment_method.attached':
      case 'payment_method.detached':
        return this.extractPaymentMethodData(event.data.object as Stripe.PaymentMethod);

      case 'customer.created':
      case 'customer.updated':
        return this.extractCustomerData(event.data.object as Stripe.Customer);

      default:
        return event.data.object;
    }
  }

  /**
   * Extract subscription data
   */
  private extractSubscriptionData(subscription: Stripe.Subscription): SubscriptionEventData {
    const customerId = typeof subscription.customer === 'string'
      ? subscription.customer
      : subscription.customer?.id || '';

    // Access properties as any since Stripe webhook data might use snake_case
    const subData = subscription as unknown as Record<string, unknown>;

    return {
      subscriptionId: subscription.id,
      customerId,
      status: this.mapSubscriptionStatus(subscription.status),
      currentPeriodStart: new Date((subData.current_period_start as number || subData.currentPeriodStart as number) * 1000).toISOString(),
      currentPeriodEnd: new Date((subData.current_period_end as number || subData.currentPeriodEnd as number) * 1000).toISOString(),
      cancelAtPeriodEnd: (subData.cancel_at_period_end as boolean || subData.cancelAtPeriodEnd as boolean) || false,
      canceledAt: subData.canceled_at
        ? new Date((subData.canceled_at as number) * 1000).toISOString()
        : (subData.canceledAt ? new Date((subData.canceledAt as number) * 1000).toISOString() : undefined),
    };
  }

  /**
   * Extract invoice data
   */
  private extractInvoiceData(invoice: Stripe.Invoice): InvoiceEventData {
    const customerId = typeof invoice.customer === 'string'
      ? invoice.customer
      : invoice.customer?.id || '';

    // Access properties as any since Stripe webhook data might use snake_case
    const invData = invoice as unknown as Record<string, unknown>;
    const subscription = invData.subscription;
    const subscriptionId = typeof subscription === 'string'
      ? subscription
      : ((subscription as Record<string, unknown> | undefined)?.id as string | undefined);
    const statusTransitions = (invData.status_transitions || invData.statusTransitions) as Record<string, unknown> | undefined;

    return {
      invoiceId: invoice.id,
      customerId,
      subscriptionId,
      amountCents: (invData.amount_paid as number || invData.amountPaid as number) || 0,
      currency: invoice.currency.toUpperCase() as InvoiceEventData['currency'],
      status: this.mapInvoiceStatus(invoice.status),
      issuedAt: new Date(invoice.created * 1000).toISOString(),
      paidAt: statusTransitions?.paid_at
        ? new Date((statusTransitions.paid_at as number) * 1000).toISOString()
        : (statusTransitions?.paidAt ? new Date((statusTransitions.paidAt as number) * 1000).toISOString() : undefined),
    };
  }

  /**
   * Extract payment method data
   */
  private extractPaymentMethodData(paymentMethod: Stripe.PaymentMethod): PaymentMethodEventData {
    const customerId = typeof paymentMethod.customer === 'string'
      ? paymentMethod.customer
      : paymentMethod.customer?.id || '';
    return {
      customerId,
      paymentMethodId: paymentMethod.id,
      brand: paymentMethod.card?.brand,
      last4: paymentMethod.card?.last4,
      expMonth: paymentMethod.card?.exp_month,
      expYear: paymentMethod.card?.exp_year,
    };
  }

  /**
   * Extract customer data
   */
  private extractCustomerData(customer: Stripe.Customer): CustomerEventData {
    return {
      customerId: customer.id,
      email: customer.email || '',
      name: customer.name || undefined,
    };
  }

  /**
   * Map Stripe subscription status to domain status
   */
  private mapSubscriptionStatus(
    stripeStatus: Stripe.Subscription.Status
  ): 'active' | 'past_due' | 'canceled' | 'incomplete' | 'trialing' | 'unpaid' {
    switch (stripeStatus) {
      case 'active':
        return 'active';
      case 'past_due':
        return 'past_due';
      case 'canceled':
        return 'canceled';
      case 'incomplete':
        return 'incomplete';
      case 'trialing':
        return 'trialing';
      case 'unpaid':
        return 'unpaid';
      case 'incomplete_expired':
        return 'incomplete';
      case 'paused':
        return 'active'; // Map paused to active for simplicity
      default:
        return 'incomplete';
    }
  }

  /**
   * Map Stripe invoice status to domain status
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
   * Type guard to check if object is a Stripe event
   */
  private isStripeEvent(obj: unknown): obj is Stripe.Event {
    return (
      typeof obj === 'object' &&
      obj !== null &&
      'id' in obj &&
      'type' in obj &&
      'data' in obj &&
      'created' in obj
    );
  }
}
