/**
 * Wompi Adapter (Colombia)
 * Payment sources + recurrent charges (KAN-166) and legacy Web Checkout.
 * @see https://docs.wompi.co/docs/colombia/fuentes-de-pago/
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
import {
  buildWompiFirstReference,
  buildWompiLegacyReference,
  parseWompiReference as parseWompiReferenceFull,
} from '../wompi-references';

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
  paymentSourceId?: number | null;
}

/**
 * Discriminated result for undocumented GET /transactions?reference=…
 * Callers must only abandon a claim on `empty` (200 + data:[]), never on `error`.
 */
export type WompiReferenceLookupResult =
  | { kind: 'found'; transaction: WompiTransactionLookup }
  | { kind: 'empty' }
  | { kind: 'error'; httpStatus?: number; message: string };

export interface WompiAcceptanceTokens {
  acceptanceToken: string;
  acceptancePermalink: string;
  personalAuthToken: string;
  personalAuthPermalink: string;
}

export interface WompiPaymentSourceResult {
  id: number;
  status: string;
  type: 'CARD' | 'NEQUI' | string;
  publicData: {
    type?: string;
    last_four?: string;
    bin?: string;
    phone_number?: string;
    card_holder?: string;
    [key: string]: unknown;
  };
}

export interface CreateWompiPaymentSourceParams {
  type: 'CARD' | 'NEQUI';
  token: string;
  customerEmail: string;
  acceptanceToken: string;
  acceptPersonalAuth: string;
}

export interface CreateWompiSourceChargeParams {
  amountInCents: number;
  currency?: string;
  customerEmail: string;
  reference: string;
  paymentSourceId: number;
  /** CARD only */
  installments?: number;
  /** Enable COF for Visa/MC on RBM */
  recurrent?: boolean;
}

// Re-export reference helpers used by webhook + tests
export {
  buildWompiFirstReference,
  buildWompiLegacyReference,
  parseWompiReferenceFull as parseWompiReferenceDetailed,
};

/** Legacy Web Checkout reference builder (kept for adapter tests / old checkouts) */
export function buildWompiReference(
  userId: string,
  planId: string,
  timestamp = Date.now()
): string {
  return buildWompiLegacyReference(userId, planId, timestamp);
}

/** Parse first-charge refs into the shape older code expects */
export function parseWompiReference(
  reference: string
): { userId: string; planId: string; timestamp: string } | null {
  const parsed = parseWompiReferenceFull(reference);
  if (!parsed) return null;
  if (parsed.kind === 'first' || parsed.kind === 'legacy_first') {
    return {
      userId: parsed.userId,
      planId: parsed.planId,
      timestamp: parsed.timestamp || parsed.subscriptionId || '',
    };
  }
  return null;
}

/**
 * Build SHA256 integrity signature for Web Checkout / API transactions.
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

export class WompiAdapter implements PaymentGateway {
  private readonly checkoutUrl: string;
  readonly apiBase: string;

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

  getPublicKey(): string {
    return this.config.publicKey;
  }

  getEnvironment(): 'sandbox' | 'production' {
    return this.config.environment;
  }

  async createCustomer(): Promise<CustomerRef> {
    throw new PaymentGatewayError(
      'Wompi uses payment sources instead of a customer vault',
      'wompi'
    );
  }

  async getOrCreateCustomer(): Promise<CustomerRef> {
    throw new PaymentGatewayError(
      'Wompi uses payment sources instead of a customer vault',
      'wompi'
    );
  }

  async attachPaymentMethod(): Promise<PaymentMethodToken> {
    throw new PaymentGatewayError(
      'Use createPaymentSource for Wompi stored methods',
      'wompi'
    );
  }

  async setDefaultPaymentMethod(): Promise<void> {
    // Local DB is source of truth for default method
  }

  async detachPaymentMethod(): Promise<void> {
    // Prefer voidPaymentSource when a provider_payment_source_id is known
  }

  async createSubscription(): Promise<SubscriptionResult> {
    throw new PaymentGatewayError(
      'Wompi has no native subscriptions; use payment sources + renewals cron',
      'wompi'
    );
  }

  async updateSubscription(): Promise<SubscriptionResult> {
    throw new PaymentGatewayError(
      'Wompi has no native subscriptions; update locally',
      'wompi'
    );
  }

  async cancelSubscription(): Promise<void> {
    // Cancel is local (cancel_at_period_end); no Wompi subscription object
  }

  async reactivateSubscription(): Promise<SubscriptionResult> {
    throw new PaymentGatewayError(
      'Reactivating subscriptions is local for Wompi',
      'wompi'
    );
  }

  async getInvoices(): Promise<InvoiceData[]> {
    throw new PaymentGatewayError(
      'Wompi invoices are managed via webhook events',
      'wompi'
    );
  }

  async getInvoice(): Promise<InvoiceData> {
    throw new PaymentGatewayError(
      'Wompi invoices are managed via webhook events',
      'wompi'
    );
  }

  /**
   * Fetch merchant acceptance tokens (public key). Safe for authenticated users.
   */
  async getAcceptanceTokens(): Promise<WompiAcceptanceTokens> {
    const response = await fetch(
      `${this.apiBase}/merchants/${encodeURIComponent(this.config.publicKey)}`,
      {
        method: 'GET',
        headers: { Accept: 'application/json' },
      }
    );

    if (!response.ok) {
      throw new PaymentGatewayError(
        `Wompi merchant lookup failed (${response.status})`,
        'wompi',
        'WOMPI_MERCHANT_LOOKUP_FAILED'
      );
    }

    const body = (await response.json()) as {
      data?: {
        presigned_acceptance?: { acceptance_token?: string; permalink?: string };
        presigned_personal_data_auth?: {
          acceptance_token?: string;
          permalink?: string;
        };
      };
    };

    const acceptance = body.data?.presigned_acceptance;
    const personal = body.data?.presigned_personal_data_auth;

    if (
      !acceptance?.acceptance_token ||
      !acceptance.permalink ||
      !personal?.acceptance_token ||
      !personal.permalink
    ) {
      throw new PaymentGatewayError(
        'Wompi merchant response missing acceptance tokens',
        'wompi',
        'WOMPI_ACCEPTANCE_MISSING'
      );
    }

    return {
      acceptanceToken: acceptance.acceptance_token,
      acceptancePermalink: acceptance.permalink,
      personalAuthToken: personal.acceptance_token,
      personalAuthPermalink: personal.permalink,
    };
  }

  /**
   * Create a payment source (PRIVATE key, server-side only).
   */
  async createPaymentSource(
    params: CreateWompiPaymentSourceParams
  ): Promise<WompiPaymentSourceResult> {
    const response = await fetch(`${this.apiBase}/payment_sources`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.privateKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        type: params.type,
        token: params.token,
        customer_email: params.customerEmail,
        acceptance_token: params.acceptanceToken,
        accept_personal_auth: params.acceptPersonalAuth,
      }),
    });

    const body = (await response.json().catch(() => ({}))) as {
      data?: WompiPaymentSourceResult;
      error?: { type?: string; reason?: string; messages?: unknown };
    };

    if (!response.ok || !body.data?.id) {
      throw new PaymentGatewayError(
        `Wompi payment source creation failed (${response.status})`,
        'wompi',
        'WOMPI_PAYMENT_SOURCE_FAILED'
      );
    }

    return body.data;
  }

  /**
   * Void a payment source (PUT /payment_sources/{id}/void).
   */
  async voidPaymentSource(paymentSourceId: number | string): Promise<void> {
    const response = await fetch(
      `${this.apiBase}/payment_sources/${encodeURIComponent(String(paymentSourceId))}/void`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${this.config.privateKey}`,
          Accept: 'application/json',
        },
      }
    );

    if (!response.ok) {
      // Soft-fail: source may already be voided
      console.warn(
        `Wompi void payment source failed (${response.status}) for id=${paymentSourceId}`
      );
    }
  }

  /**
   * Charge a stored payment source (PRIVATE key). Returns PENDING initially.
   */
  async createSourceTransaction(
    params: CreateWompiSourceChargeParams
  ): Promise<WompiTransactionLookup> {
    const currency = params.currency || 'COP';
    const signature = buildWompiIntegritySignature({
      reference: params.reference,
      amountInCents: params.amountInCents,
      currency,
      integritySecret: this.config.integritySecret,
    });

    const body: Record<string, unknown> = {
      amount_in_cents: params.amountInCents,
      currency,
      customer_email: params.customerEmail,
      reference: params.reference,
      payment_source_id: params.paymentSourceId,
      signature,
    };

    if (params.recurrent !== undefined) {
      body.recurrent = params.recurrent;
    }

    // Cards require installments; Nequi must omit payment_method
    if (params.installments != null) {
      body.payment_method = { installments: params.installments };
    }

    const response = await fetch(`${this.apiBase}/transactions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.privateKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    });

    const payload = (await response.json().catch(() => ({}))) as {
      data?: {
        id?: string;
        status?: string;
        reference?: string;
        amount_in_cents?: number;
        currency?: string;
        customer_email?: string | null;
        payment_source_id?: number;
      };
      error?: unknown;
    };

    if (!response.ok || !payload.data?.id) {
      const providerMessage =
        typeof payload.error === 'string'
          ? payload.error
          : payload.error
            ? JSON.stringify(payload.error)
            : undefined;
      throw new PaymentGatewayError(
        `Wompi source transaction failed (${response.status})`,
        'wompi',
        'WOMPI_SOURCE_CHARGE_FAILED',
        response.status,
        providerMessage
      );
    }

    const data = payload.data;
    return {
      id: data.id!,
      status: data.status || 'PENDING',
      reference: data.reference || params.reference,
      amountInCents: data.amount_in_cents ?? params.amountInCents,
      currency: data.currency || currency,
      customerEmail: data.customer_email,
      paymentSourceId: data.payment_source_id ?? params.paymentSourceId,
    };
  }

  /**
   * Poll until transaction leaves PENDING or timeout.
   */
  async waitForTransactionStatus(
    transactionId: string,
    options: { timeoutMs?: number; intervalMs?: number } = {}
  ): Promise<WompiTransactionLookup> {
    const timeoutMs = options.timeoutMs ?? 8000;
    const intervalMs = options.intervalMs ?? 1000;
    const started = Date.now();
    let last = await this.getTransaction(transactionId);

    while (
      last.status.toUpperCase() === 'PENDING' &&
      Date.now() - started < timeoutMs
    ) {
      await new Promise(r => setTimeout(r, intervalMs));
      last = await this.getTransaction(transactionId);
    }
    return last;
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
      'Customer portal is not available for Wompi',
      'wompi'
    );
  }

  /**
   * Lookup by merchant reference (private key).
   * Undocumented but verified on sandbox: GET /v1/transactions?reference=…
   * Returns a discriminated result so callers never treat lookup failure as
   * "no transaction exists" (which would risk double-charging).
   */
  async findTransactionByReference(
    reference: string
  ): Promise<WompiReferenceLookupResult> {
    let response: Response;
    try {
      response = await fetch(
        `${this.apiBase}/transactions?reference=${encodeURIComponent(reference)}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${this.config.privateKey}`,
            Accept: 'application/json',
          },
        }
      );
    } catch (err) {
      return {
        kind: 'error',
        message: err instanceof Error ? err.message : 'Network error',
      };
    }

    if (!response.ok) {
      return {
        kind: 'error',
        httpStatus: response.status,
        message: `HTTP ${response.status}`,
      };
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { kind: 'error', httpStatus: 200, message: 'Invalid JSON body' };
    }

    const data = (body as { data?: unknown })?.data;

    // Contract: 200 + data: [] means no transaction for this reference
    if (Array.isArray(data) && data.length === 0) {
      return { kind: 'empty' };
    }

    const raw = Array.isArray(data) ? data[0] : data;
    if (
      !raw ||
      typeof raw !== 'object' ||
      !(raw as { id?: string }).id ||
      !(raw as { status?: string }).status ||
      !(raw as { reference?: string }).reference ||
      (raw as { amount_in_cents?: number }).amount_in_cents == null
    ) {
      return {
        kind: 'error',
        httpStatus: 200,
        message: 'Unexpected response shape',
      };
    }

    const row = raw as {
      id: string;
      status: string;
      reference: string;
      amount_in_cents: number;
      currency?: string;
      customer_email?: string | null;
      payment_source_id?: number | null;
    };

    return {
      kind: 'found',
      transaction: {
        id: row.id,
        status: row.status,
        reference: row.reference,
        amountInCents: row.amount_in_cents,
        currency: row.currency || 'COP',
        customerEmail: row.customer_email,
        paymentSourceId: row.payment_source_id,
      },
    };
  }

  /**
   * Lookup a transaction by id (server-side only; private key Bearer).
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
        payment_source_id?: number | null;
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
      paymentSourceId: data.payment_source_id,
    };
  }
}
