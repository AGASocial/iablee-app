/**
 * Wompi Adapter (Colombia)
 * Minimal PaymentGateway for Web Checkout (GET form) — renew-by-checkout model.
 * @see https://docs.wompi.co/en/docs/colombia/widget-checkout-web/
 */

import crypto from 'crypto';
import type {
  PaymentGateway,
  SubscriptionResult,
  InvoiceData,
} from '../gateway.interface';
import type {
  CustomerRef,
  PaymentMethodToken,
  PaymentProvider,
  PlanDefinition,
} from '../types';
import { PaymentGatewayError } from '../types';
import { resolveWompiAmountInCents } from '../wompi-pricing';

export interface WompiAdapterConfig {
  environment: 'sandbox' | 'production';
  publicKey: string;
  privateKey: string;
  integritySecret: string;
  redirectUrl: string;
  /** Default: https://checkout.wompi.co/p/ */
  checkoutUrl?: string;
}

export interface WompiTransactionLookup {
  id: string;
  status: string;
  reference: string;
  amountInCents: number;
  currency: string;
  customerEmail?: string | null;
}

const REFERENCE_PATTERN =
  /^wompi_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})_(plan_[a-z0-9_]+)_(\d+)$/i;

/**
 * Build SHA256 integrity signature for Web Checkout.
 * Concat (no separators): reference + amountInCents + currency [+ expirationTime] + integritySecret
 */
export function buildWompiIntegritySignature(params: {
  reference: string;
  amountInCents: number | string;
  currency: string;
  integritySecret: string;
  expirationTime?: string;
}): string {
  const amount = String(params.amountInCents);
  const parts = params.expirationTime
    ? [
        params.reference,
        amount,
        params.currency,
        params.expirationTime,
        params.integritySecret,
      ]
    : [params.reference, amount, params.currency, params.integritySecret];

  return crypto.createHash('sha256').update(parts.join('')).digest('hex');
}

export function buildWompiReference(
  userId: string,
  planId: string,
  timestamp = Date.now()
): string {
  return `wompi_${userId}_${planId}_${timestamp}`;
}

export function parseWompiReference(
  reference: string
): { userId: string; planId: string; timestamp: string } | null {
  const match = REFERENCE_PATTERN.exec(reference);
  if (!match) return null;
  return {
    userId: match[1],
    planId: match[2],
    timestamp: match[3],
  };
}

export class WompiAdapter implements PaymentGateway {
  private readonly checkoutUrl: string;
  private readonly apiBase: string;

  constructor(private readonly config: WompiAdapterConfig) {
    const required = [
      config.publicKey,
      config.privateKey,
      config.integritySecret,
      config.redirectUrl,
    ];
    if (required.some(value => !value)) {
      throw new Error('Wompi adapter is missing required configuration values');
    }
    this.checkoutUrl = config.checkoutUrl || 'https://checkout.wompi.co/p/';
    this.apiBase =
      config.environment === 'production'
        ? 'https://production.wompi.co/v1'
        : 'https://sandbox.wompi.co/v1';
  }

  getName(): PaymentProvider {
    return 'wompi';
  }

  async createCustomer(): Promise<CustomerRef> {
    throw new PaymentGatewayError(
      'Wompi Web Checkout does not support customer vaulting. Recurring via payment sources is a follow-up.',
      'wompi'
    );
  }

  async getOrCreateCustomer(): Promise<CustomerRef> {
    throw new PaymentGatewayError(
      'Wompi Web Checkout does not support customer vaulting. Recurring via payment sources is a follow-up.',
      'wompi'
    );
  }

  async attachPaymentMethod(): Promise<PaymentMethodToken> {
    throw new PaymentGatewayError(
      'Wompi Web Checkout does not support saving payment methods. Recurring via payment sources is a follow-up.',
      'wompi'
    );
  }

  async setDefaultPaymentMethod(): Promise<void> {
    throw new PaymentGatewayError(
      'Wompi Web Checkout does not support saving payment methods. Recurring via payment sources is a follow-up.',
      'wompi'
    );
  }

  async detachPaymentMethod(): Promise<void> {
    throw new PaymentGatewayError(
      'Wompi Web Checkout does not support saving payment methods. Recurring via payment sources is a follow-up.',
      'wompi'
    );
  }

  async createSubscription(): Promise<SubscriptionResult> {
    throw new PaymentGatewayError(
      'Wompi has no native subscriptions; use Web Checkout renew-by-checkout (createCheckoutSession).',
      'wompi'
    );
  }

  async updateSubscription(): Promise<SubscriptionResult> {
    throw new PaymentGatewayError(
      'Wompi has no native subscriptions; renewals use Web Checkout.',
      'wompi'
    );
  }

  async cancelSubscription(): Promise<void> {
    throw new PaymentGatewayError(
      'Canceling subscriptions is not supported through Wompi Web Checkout; cancel locally.',
      'wompi'
    );
  }

  async reactivateSubscription(): Promise<SubscriptionResult> {
    throw new PaymentGatewayError(
      'Reactivating subscriptions is not supported through Wompi Web Checkout.',
      'wompi'
    );
  }

  async getInvoices(): Promise<InvoiceData[]> {
    throw new PaymentGatewayError(
      'Wompi Web Checkout invoices are managed via webhook events',
      'wompi'
    );
  }

  async getInvoice(): Promise<InvoiceData> {
    throw new PaymentGatewayError(
      'Wompi Web Checkout invoices are managed via webhook events',
      'wompi'
    );
  }

  async createCheckoutSession(params: {
    customer?: CustomerRef;
    plan: PlanDefinition;
    successUrl: string;
    cancelUrl: string;
    metadata?: Record<string, string>;
    customerData?: {
      email?: string;
      name?: string;
      userId?: string;
    };
  }): Promise<{
    sessionId: string;
    url: string;
    formFields?: Record<string, string>;
    formMethod?: 'GET' | 'POST';
  }> {
    const { plan, metadata, customerData } = params;
    const userId = metadata?.user_id || customerData?.userId || '';
    const planId = metadata?.plan_id || plan.id;

    if (!userId || !planId) {
      throw new PaymentGatewayError(
        'Wompi checkout requires user_id and plan_id metadata',
        'wompi',
        'WOMPI_CHECKOUT_METADATA'
      );
    }

    const amountInCents = resolveWompiAmountInCents(
      planId,
      plan.providerPriceMap?.wompi
    );

    const reference =
      metadata?.reference_code || buildWompiReference(userId, planId);

    const signature = buildWompiIntegritySignature({
      reference,
      amountInCents,
      currency: 'COP',
      integritySecret: this.config.integritySecret,
    });

    const formFields: Record<string, string> = {
      'public-key': this.config.publicKey,
      currency: 'COP',
      'amount-in-cents': String(amountInCents),
      reference,
      'signature:integrity': signature,
      'redirect-url': this.config.redirectUrl,
    };

    if (customerData?.email) {
      formFields['customer-data:email'] = customerData.email;
    }
    if (customerData?.name) {
      formFields['customer-data:full-name'] = customerData.name;
    }

    return {
      sessionId: reference,
      url: this.checkoutUrl,
      formFields,
      formMethod: 'GET',
    };
  }

  async createPortalSession(): Promise<{ url: string }> {
    throw new PaymentGatewayError(
      'Customer portal is not available for Wompi Web Checkout',
      'wompi'
    );
  }

  /**
   * Lookup a transaction by id (server-side only; private key Bearer).
   * Informational — not the source of truth for subscription activation.
   */
  async getTransaction(transactionId: string): Promise<WompiTransactionLookup> {
    const response = await fetch(
      `${this.apiBase}/transactions/${encodeURIComponent(transactionId)}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.config.privateKey}`,
          Accept: 'application/json',
        },
      }
    );

    if (!response.ok) {
      throw new PaymentGatewayError(
        `Wompi transaction lookup failed (${response.status})`,
        'wompi',
        'WOMPI_TRANSACTION_LOOKUP_FAILED'
      );
    }

    const body = (await response.json()) as {
      data?: {
        id?: string;
        status?: string;
        reference?: string;
        amount_in_cents?: number;
        currency?: string;
        customer_email?: string | null;
      };
    };

    const data = body.data;
    if (!data?.id || !data.status || !data.reference || data.amount_in_cents == null) {
      throw new PaymentGatewayError(
        'Wompi transaction lookup returned incomplete data',
        'wompi',
        'WOMPI_TRANSACTION_LOOKUP_MALFORMED'
      );
    }

    return {
      id: data.id,
      status: data.status,
      reference: data.reference,
      amountInCents: data.amount_in_cents,
      currency: data.currency || 'COP',
      customerEmail: data.customer_email,
    };
  }
}
