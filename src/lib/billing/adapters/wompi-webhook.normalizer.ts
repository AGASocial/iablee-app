/**
 * Wompi Webhook Normalizer
 * Verifies event checksum and maps transaction.updated → domain events.
 * @see https://docs.wompi.co/en/docs/colombia/eventos/
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
import { parseWompiReference } from './wompi.adapter';

export interface WompiEventSignature {
  properties: string[];
  checksum: string;
}

export interface WompiTransactionPayload {
  id: string;
  status: string;
  reference: string;
  amount_in_cents: number;
  currency: string;
  customer_email?: string | null;
  [key: string]: unknown;
}

export interface WompiEventBody {
  event: string;
  data: {
    transaction?: WompiTransactionPayload;
    [key: string]: unknown;
  };
  sent_at?: string;
  timestamp: number;
  signature: WompiEventSignature;
  environment?: string;
}

type WompiFinalStatus = 'APPROVED' | 'DECLINED' | 'VOIDED' | 'ERROR' | 'PENDING';

interface WompiWebhookConfig {
  eventsSecret: string;
}

/**
 * Resolve a dotted path against an object (e.g. "transaction.id" → data.transaction.id).
 * Paths in signature.properties are relative to the event `data` object.
 */
export function getWompiPropertyValue(
  data: Record<string, unknown>,
  propertyPath: string
): string {
  const parts = propertyPath.split('.');
  let current: unknown = data;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') {
      throw new Error(`Missing Wompi signature property path: ${propertyPath}`);
    }
    current = (current as Record<string, unknown>)[part];
  }
  if (current === undefined || current === null) {
    throw new Error(`Missing Wompi signature property value: ${propertyPath}`);
  }
  return String(current);
}

/**
 * Build event checksum: concat(property values in signature.properties order) + timestamp + eventsSecret → SHA256 hex
 */
export function buildWompiEventChecksum(params: {
  data: Record<string, unknown>;
  properties: string[];
  timestamp: number;
  eventsSecret: string;
}): string {
  const values = params.properties.map(prop =>
    getWompiPropertyValue(params.data, prop)
  );
  const concatenated =
    values.join('') + String(params.timestamp) + params.eventsSecret;
  return crypto.createHash('sha256').update(concatenated).digest('hex');
}

function timingSafeEqualHex(a: string, b: string): boolean {
  const aNorm = a.toLowerCase();
  const bNorm = b.toLowerCase();
  if (aNorm.length !== bNorm.length) {
    return false;
  }
  try {
    return crypto.timingSafeEqual(
      Buffer.from(aNorm, 'utf8'),
      Buffer.from(bNorm, 'utf8')
    );
  } catch {
    return false;
  }
}

export class WompiWebhookNormalizer implements WebhookNormalizer {
  constructor(private readonly config: WompiWebhookConfig) {
    if (!config.eventsSecret) {
      throw new Error('Wompi webhook normalizer requires eventsSecret');
    }
  }

  provider(): PaymentProvider {
    return 'wompi';
  }

  async verify(
    payload: string | object,
    headers: Record<string, string | string[] | undefined> = {},
    _secret?: string
  ): Promise<WebhookVerificationResult> {
    const event = this.parsePayload(payload);
    if (!event) {
      return { verified: false, error: 'Invalid Wompi webhook payload' };
    }

    if (!event.signature?.properties?.length || event.timestamp == null) {
      return { verified: false, error: 'Missing Wompi signature fields' };
    }

    const headerChecksum = this.getHeaderChecksum(headers);
    const provided =
      headerChecksum || event.signature.checksum || '';

    if (!provided) {
      return { verified: false, error: 'Missing Wompi event checksum' };
    }

    let expected: string;
    try {
      expected = buildWompiEventChecksum({
        data: event.data as Record<string, unknown>,
        properties: event.signature.properties,
        timestamp: event.timestamp,
        eventsSecret: this.config.eventsSecret,
      });
    } catch (error) {
      return {
        verified: false,
        error: error instanceof Error ? error.message : 'Checksum property resolution failed',
      };
    }

    if (!timingSafeEqualHex(expected, provided)) {
      return { verified: false, error: 'Invalid Wompi event checksum' };
    }

    return { verified: true, event };
  }

  normalize(raw: unknown): NormalizedEvent | null {
    if (!this.isEventBody(raw)) {
      return null;
    }

    if (raw.event !== 'transaction.updated') {
      return null;
    }

    const transaction = raw.data?.transaction;
    if (!transaction?.id || !transaction.status || !transaction.reference) {
      return null;
    }

    const status = this.mapStatus(transaction.status);
    if (!status) {
      return null;
    }

    const occurredAt = raw.sent_at
      ? new Date(raw.sent_at).toISOString()
      : new Date(raw.timestamp * 1000).toISOString();

    const parsed = parseWompiReference(transaction.reference);
    const eventId = `${transaction.id}-${status}`;

    if (status === 'PENDING') {
      const subscriptionData = this.buildSubscriptionData(
        transaction,
        occurredAt,
        parsed
      );
      if (!subscriptionData) {
        return null;
      }

      return {
        id: eventId,
        type: 'subscription.updated',
        occurredAt,
        provider: 'wompi',
        raw,
        data: subscriptionData,
      };
    }

    const invoiceData = this.buildInvoiceData(
      transaction,
      status,
      occurredAt,
      parsed
    );

    return {
      id: eventId,
      type: status === 'APPROVED' ? 'invoice.paid' : 'invoice.payment_failed',
      occurredAt,
      provider: 'wompi',
      raw,
      data: invoiceData,
    };
  }

  shouldProcess(eventType: string): boolean {
    return (eventType || '').toLowerCase() === 'transaction.updated';
  }

  getEventId(raw: unknown): string | null {
    if (!this.isEventBody(raw)) {
      return null;
    }
    const transaction = raw.data?.transaction;
    if (!transaction?.id || !transaction.status) {
      return null;
    }
    const status = this.mapStatus(transaction.status);
    if (!status) {
      return null;
    }
    return `${transaction.id}-${status}`;
  }

  private parsePayload(payload: string | object): WompiEventBody | null {
    if (typeof payload === 'string') {
      try {
        const parsed = JSON.parse(payload) as unknown;
        return this.isEventBody(parsed) ? parsed : null;
      } catch {
        return null;
      }
    }
    return this.isEventBody(payload) ? payload : null;
  }

  private isEventBody(value: unknown): value is WompiEventBody {
    if (typeof value !== 'object' || value === null) {
      return false;
    }
    const body = value as Partial<WompiEventBody>;
    return (
      typeof body.event === 'string' &&
      typeof body.data === 'object' &&
      body.data !== null &&
      typeof body.timestamp === 'number' &&
      typeof body.signature === 'object' &&
      body.signature !== null
    );
  }

  private getHeaderChecksum(
    headers: Record<string, string | string[] | undefined>
  ): string {
    const raw =
      headers['x-event-checksum'] ??
      headers['X-Event-Checksum'] ??
      headers['X-EVENT-CHECKSUM'];
    if (Array.isArray(raw)) {
      return raw[0] || '';
    }
    return raw || '';
  }

  private mapStatus(value: string): WompiFinalStatus | null {
    const normalized = value.toUpperCase();
    if (
      normalized === 'APPROVED' ||
      normalized === 'DECLINED' ||
      normalized === 'VOIDED' ||
      normalized === 'ERROR' ||
      normalized === 'PENDING'
    ) {
      return normalized;
    }
    return null;
  }

  private buildSubscriptionData(
    transaction: WompiTransactionPayload,
    occurredAt: string,
    parsed: ReturnType<typeof parseWompiReference>
  ): SubscriptionEventData | null {
    if (!transaction.reference) {
      return null;
    }

    return {
      subscriptionId: transaction.reference,
      customerId: parsed?.userId || transaction.customer_email || 'wompi-anonymous',
      planId: parsed?.planId,
      status: 'incomplete',
      currentPeriodStart: occurredAt,
      userId: parsed?.userId,
    };
  }

  private buildInvoiceData(
    transaction: WompiTransactionPayload,
    status: Exclude<WompiFinalStatus, 'PENDING'>,
    occurredAt: string,
    parsed: ReturnType<typeof parseWompiReference>
  ): InvoiceEventData {
    return {
      invoiceId: transaction.reference,
      customerId: parsed?.userId || transaction.customer_email || 'wompi-anonymous',
      subscriptionId: transaction.reference,
      amountCents: Number(transaction.amount_in_cents) || 0,
      currency: (transaction.currency || 'COP') as Currency,
      status: status === 'APPROVED' ? 'paid' : 'open',
      issuedAt: occurredAt,
      paidAt: status === 'APPROVED' ? occurredAt : undefined,
      userId: parsed?.userId,
      planId: parsed?.planId,
      rawStatus: transaction.status,
    };
  }
}
