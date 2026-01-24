/**
 * PayU Adapter
 * Minimal PaymentGateway implementation for the WebCheckout flow
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

interface PayUAdapterConfig {
  apiKey: string;
  apiLogin: string;
  merchantId: string;
  accountId: string;
  paymentUrl: string;
  responseUrl: string;
  confirmationUrl: string;
  environment: 'sandbox' | 'production';
  language?: string;
}

export class PayUAdapter implements PaymentGateway {
  constructor(private readonly config: PayUAdapterConfig) {
    const required = [
      config.apiKey,
      config.apiLogin,
      config.merchantId,
      config.accountId,
      config.paymentUrl,
      config.responseUrl,
      config.confirmationUrl,
    ];

    if (required.some(value => !value)) {
      throw new Error('PayU adapter is missing required configuration values');
    }
  }

  getName(): PaymentProvider {
    return 'payu';
  }

  async createCustomer(): Promise<CustomerRef> {
    throw new PaymentGatewayError('PayU WebCheckout does not support customer vaulting', 'payu');
  }

  async getOrCreateCustomer(): Promise<CustomerRef> {
    throw new PaymentGatewayError('PayU WebCheckout does not support customer vaulting', 'payu');
  }

  async attachPaymentMethod(): Promise<PaymentMethodToken> {
    throw new PaymentGatewayError('PayU WebCheckout does not support saving payment methods', 'payu');
  }

  async setDefaultPaymentMethod(): Promise<void> {
    throw new PaymentGatewayError('PayU WebCheckout does not support saving payment methods', 'payu');
  }

  async detachPaymentMethod(): Promise<void> {
    throw new PaymentGatewayError('PayU WebCheckout does not support saving payment methods', 'payu');
  }

  async createSubscription(): Promise<SubscriptionResult> {
    throw new PaymentGatewayError('PayU WebCheckout subscriptions are handled via checkout redirects', 'payu');
  }

  async updateSubscription(): Promise<SubscriptionResult> {
    throw new PaymentGatewayError('PayU WebCheckout subscriptions are handled via checkout redirects', 'payu');
  }

  async cancelSubscription(): Promise<void> {
    throw new PaymentGatewayError('Canceling subscriptions is not supported through PayU WebCheckout', 'payu');
  }

  async reactivateSubscription(): Promise<SubscriptionResult> {
    throw new PaymentGatewayError('Reactivating subscriptions is not supported through PayU WebCheckout', 'payu');
  }

  async getInvoices(): Promise<InvoiceData[]> {
    throw new PaymentGatewayError('PayU WebCheckout invoices are managed via webhook events', 'payu');
  }

  async getInvoice(): Promise<InvoiceData> {
    throw new PaymentGatewayError('PayU WebCheckout invoices are managed via webhook events', 'payu');
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
  }> {
    const { plan, metadata, customerData } = params;
    const referenceCode = metadata?.reference_code || `payu_ref_${Date.now()}`;
    const amount = this.formatAmount(plan.amountCents);
    const signature = this.generateSignature(referenceCode, amount, plan.currency);

    const formFields: Record<string, string> = {
      merchantId: this.config.merchantId,
      accountId: this.config.accountId,
      description: plan.name,
      referenceCode,
      amount,
      tax: '0',
      taxReturnBase: '0',
      currency: plan.currency,
      signature,
      test: this.config.environment === 'sandbox' ? '1' : '0',
      buyerEmail: customerData?.email || '',
      buyerFullName: customerData?.name || '',
      responseUrl: this.config.responseUrl,
      confirmationUrl: this.config.confirmationUrl,
      language: this.config.language || 'es',
      extra1: metadata?.user_id || customerData?.userId || '',
      extra2: metadata?.plan_id || plan.id || '',
    };

    // Remove empty values to avoid PayU validation errors
    Object.keys(formFields).forEach(key => {
      if (formFields[key] === '') {
        delete formFields[key];
      }
    });

    return {
      sessionId: referenceCode,
      url: this.config.paymentUrl,
      formFields,
    };
  }

  async createPortalSession(): Promise<{ url: string }> {
    throw new PaymentGatewayError('Customer portal is not available for PayU WebCheckout', 'payu');
  }

  private formatAmount(amountCents: number): string {
    return (amountCents / 100).toFixed(2);
  }

  private generateSignature(referenceCode: string, amount: string, currency: string): string {
    const signatureString = [
      this.config.apiKey,
      this.config.merchantId,
      referenceCode,
      amount,
      currency,
    ].join('~');

    return crypto.createHash('md5').update(signatureString).digest('hex');
  }
}
