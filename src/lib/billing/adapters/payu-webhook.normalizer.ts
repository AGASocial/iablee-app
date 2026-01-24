/**
 * PayU Webhook Normalizer
 * Converts PayU confirmation/response payloads into normalized events
 */

import crypto from 'crypto';
import type { WebhookNormalizer, WebhookVerificationResult } from '../webhook-normalizer.interface';
import type {
  NormalizedEvent,
  PaymentProvider,
  SubscriptionEventData,
  InvoiceEventData,
  Currency,
} from '../types';

type PayUWebhookPayload = Record<string, string>;

interface PayUWebhookConfig {
  apiKey: string;
  merchantId: string;
}

type PayUState = 'APPROVED' | 'DECLINED' | 'PENDING';

export class PayUWebhookNormalizer implements WebhookNormalizer {
  constructor(private readonly config: PayUWebhookConfig) { }

  provider(): PaymentProvider {
    return 'payu';
  }

  async verify(payload: string | object): Promise<WebhookVerificationResult> {
    const event = this.normalizePayload(payload);

    if (!event) {
      return { verified: false, error: 'Invalid webhook payload' };
    }

    const providedSignature =
      event.signature || event.sign || event.firma || event.signature_responde || '';

    if (!providedSignature) {
      return { verified: false, error: 'Missing PayU signature' };
    }

    const expectedSignature = this.generateSignature(event);

    if (expectedSignature !== providedSignature.toLowerCase()) {
      return { verified: false, error: 'Invalid PayU signature' };
    }

    return {
      verified: true,
      event,
    };
  }

  normalize(raw: unknown): NormalizedEvent | null {
    if (!this.isPayload(raw)) {
      return null;
    }

    const payload = raw as PayUWebhookPayload;
    const state = this.mapState(payload.state_pol || payload.response_code_pol || payload.state);

    if (!state) {
      return null;
    }

    const occurredAt = this.getDate(payload);

    if (state === 'PENDING') {
      const subscriptionData = this.buildSubscriptionData(payload, occurredAt);
      if (!subscriptionData) {
        return null;
      }

      return {
        id: `${subscriptionData.subscriptionId}-pending`,
        type: 'subscription.updated',
        occurredAt,
        provider: 'payu',
        raw: payload,
        data: subscriptionData,
      };
    }

    const invoiceData = this.buildInvoiceData(payload, state, occurredAt);

    return {
      id: `${invoiceData.invoiceId}-${state.toLowerCase()}`,
      type: state === 'APPROVED' ? 'invoice.paid' : 'invoice.payment_failed',
      occurredAt,
      provider: 'payu',
      raw: payload,
      data: invoiceData,
    };
  }

  shouldProcess(eventType: string): boolean {
    return ['APPROVED', 'DECLINED', 'PENDING'].includes(
      (eventType || '').toUpperCase()
    );
  }

  getEventId(raw: unknown): string | null {
    if (!this.isPayload(raw)) {
      return null;
    }
    const payload = raw as PayUWebhookPayload;
    return payload.reference_pol || payload.transaction_id || payload.reference_sale || null;
  }

  private isPayload(value: unknown): value is PayUWebhookPayload {
    return typeof value === 'object' && value !== null;
  }

  private normalizePayload(payload: string | object): PayUWebhookPayload | null {
    if (typeof payload === 'string') {
      const parsed = Object.fromEntries(new URLSearchParams(payload));
      return parsed;
    }

    if (this.isPayload(payload)) {
      return payload as PayUWebhookPayload;
    }

    return null;
  }

  private mapState(value?: string | null): PayUState | null {
    if (!value) {
      return null;
    }

    const normalized = value.toString().toUpperCase();

    if (normalized === '4' || normalized === 'APPROVED') {
      return 'APPROVED';
    }
    if (normalized === '6' || normalized === 'DECLINED') {
      return 'DECLINED';
    }
    if (normalized === '7' || normalized === 'PENDING') {
      return 'PENDING';
    }

    return null;
  }

  private generateSignature(payload: PayUWebhookPayload): string {
    const reference = this.getReference(payload);
    const amount = this.getAmount(payload);
    const currency = payload.currency || 'USD';
    const state = (payload.state_pol || payload.state || '').toUpperCase();

    const signatureString = [
      this.config.apiKey,
      this.config.merchantId,
      reference,
      amount,
      currency,
      state,
    ].join('~');

    return crypto.createHash('md5').update(signatureString).digest('hex');
  }

  private getReference(payload: PayUWebhookPayload): string {
    return (
      payload.reference_sale ||
      payload.referenceCode ||
      payload.reference_pol ||
      `payu-ref-${payload.transaction_id || Date.now()}`
    );
  }

  private getAmount(payload: PayUWebhookPayload): string {
    const raw = payload.value || payload.TX_VALUE || '0';
    return Number(parseFloat(raw.replace(',', '.')) || 0).toFixed(2);
  }

  private getDate(payload: PayUWebhookPayload): string {
    const dateString = payload.transaction_date || payload.processing_date || new Date().toISOString();
    return new Date(dateString).toISOString();
  }

  private buildSubscriptionData(
    payload: PayUWebhookPayload,
    occurredAt: string
  ): SubscriptionEventData | null {
    const reference = this.getReference(payload);
    const customerId = this.getCustomerId(payload);

    if (!reference) {
      return null;
    }

    return {
      subscriptionId: reference,
      customerId,
      planId: payload.extra2,
      status: 'incomplete',
      currentPeriodStart: occurredAt,
      userId: payload.extra1,
    };
  }

  private buildInvoiceData(
    payload: PayUWebhookPayload,
    state: PayUState,
    occurredAt: string
  ): InvoiceEventData {
    const reference = this.getReference(payload);
    const amountCents = Math.round(parseFloat(this.getAmount(payload)) * 100);
    const currency = (payload.currency || 'USD') as Currency;

    return {
      invoiceId: reference,
      customerId: this.getCustomerId(payload),
      subscriptionId: reference,
      amountCents,
      currency,
      status: state === 'APPROVED' ? 'paid' : 'open',
      issuedAt: occurredAt,
      paidAt: state === 'APPROVED' ? occurredAt : undefined,
      userId: payload.extra1,
      planId: payload.extra2,
      rawStatus: payload.state_pol || payload.state,
    };
  }

  private getCustomerId(payload: PayUWebhookPayload): string {
    return (
      payload.extra1 ||
      payload.buyerEmail ||
      payload.email_buyer ||
      payload.customer_number ||
      'payu-anonymous'
    );
  }
}
