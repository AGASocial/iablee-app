/**
 * Wompi first purchase + payment method management (KAN-166).
 * Card tokenization happens in the browser; this module only receives tokens.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { WompiAdapter } from './adapters/wompi.adapter';
import type { PlanDefinition, CreateSubscriptionResponse, SubscriptionStatus } from './types';
import { BillingError } from './types';
import { resolveWompiAmountInCents } from './wompi-pricing';
import { buildWompiFirstReference, toPeriodEndYmd } from './wompi-references';
import { extendPeriodEnd } from './dunning';
import {
  getBillingEmailSender,
  sendBillingEmailOnce,
  type BillingEmailSender,
} from './billing-emails';
import { chargeWompiPastDueNow } from './renewals';

export interface WompiTokenMeta {
  brand?: string;
  lastFour?: string;
  expMonth?: number;
  expYear?: number;
  /** Nequi phone last4 when type=NEQUI (extension point) */
  phoneLast4?: string;
}

export interface CreateWompiSourceAndSubscribeParams {
  userId: string;
  plan: PlanDefinition;
  email: string;
  locale?: string | null;
  paymentType: 'CARD' | 'NEQUI';
  /** Card/Nequi token from browser → Wompi (never a PAN) */
  paymentToken: string;
  acceptanceToken: string;
  acceptPersonalAuth: string;
  tokenMeta?: WompiTokenMeta;
  emailSender?: BillingEmailSender;
}

export interface ReplaceWompiPaymentMethodParams {
  userId: string;
  email: string;
  paymentType: 'CARD' | 'NEQUI';
  paymentToken: string;
  acceptanceToken: string;
  acceptPersonalAuth: string;
  tokenMeta?: WompiTokenMeta;
  emailSender?: BillingEmailSender;
}

function mapTxStatus(status: string): SubscriptionStatus | 'declined' | 'error' | 'pending' {
  const s = status.toUpperCase();
  if (s === 'APPROVED') return 'active';
  if (s === 'DECLINED') return 'declined';
  if (s === 'ERROR' || s === 'VOIDED') return 'error';
  return 'pending';
}

async function persistPaymentMethod(
  supabase: SupabaseClient,
  params: {
    userId: string;
    email: string;
    sourceId: number;
    paymentType: 'CARD' | 'NEQUI';
    tokenMeta?: WompiTokenMeta;
    setDefault?: boolean;
  }
): Promise<string> {
  if (params.setDefault !== false) {
    await supabase
      .from('billing_payment_methods')
      .update({ is_default: false })
      .eq('user_id', params.userId)
      .eq('provider', 'wompi');
  }

  const brand =
    params.tokenMeta?.brand ||
    (params.paymentType === 'NEQUI' ? 'Nequi' : undefined);

  const last4 =
    params.tokenMeta?.lastFour ||
    params.tokenMeta?.phoneLast4 ||
    null;

  const { data, error } = await supabase
    .from('billing_payment_methods')
    .insert({
      user_id: params.userId,
      provider: 'wompi',
      provider_customer_id: params.email,
      token: String(params.sourceId),
      provider_payment_source_id: String(params.sourceId),
      method_type: params.paymentType,
      brand: brand || null,
      last4,
      phone_last4: params.tokenMeta?.phoneLast4 || null,
      exp_month: params.tokenMeta?.expMonth ?? null,
      exp_year: params.tokenMeta?.expYear ?? null,
      is_default: params.setDefault !== false,
    })
    .select('id')
    .single();

  if (error || !data) {
    throw new BillingError(
      'Failed to save Wompi payment method',
      'SAVE_PAYMENT_METHOD_FAILED'
    );
  }

  return data.id as string;
}

async function resolveSubscriptionRow(
  supabase: SupabaseClient,
  userId: string,
  planId: string,
  reference: string
): Promise<{ id: string; status: string }> {
  const { data: existing } = await supabase
    .from('billing_subscriptions')
    .select('id, status')
    .eq('user_id', userId)
    .eq('provider', 'wompi')
    .in('status', ['active', 'past_due', 'incomplete', 'trialing'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    await supabase
      .from('billing_subscriptions')
      .update({
        plan_id: planId,
        provider_subscription_id: reference,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id);
    return { id: existing.id as string, status: existing.status as string };
  }

  const { data: created, error } = await supabase
    .from('billing_subscriptions')
    .insert({
      user_id: userId,
      plan_id: planId,
      status: 'incomplete',
      provider: 'wompi',
      provider_subscription_id: reference,
      cancel_at_period_end: false,
    })
    .select('id, status')
    .single();

  if (error || !created) {
    throw new BillingError(
      'Failed to create Wompi subscription',
      'CREATE_SUBSCRIPTION_FAILED'
    );
  }

  return { id: created.id as string, status: created.status as string };
}

/**
 * Create payment source + first charge. Activates on APPROVED (poll and/or webhook).
 */
export async function createWompiSourceAndSubscribe(
  supabase: SupabaseClient,
  wompi: WompiAdapter,
  params: CreateWompiSourceAndSubscribeParams
): Promise<
  CreateSubscriptionResponse & {
    transactionStatus: string;
    paymentMethodId?: string;
    transactionId?: string;
  }
> {
  const amountInCents = resolveWompiAmountInCents(
    params.plan.id,
    params.plan.providerPriceMap?.wompi
  );
  const reference = buildWompiFirstReference(params.userId, params.plan.id);

  const source = await wompi.createPaymentSource({
    type: params.paymentType,
    token: params.paymentToken,
    customerEmail: params.email,
    acceptanceToken: params.acceptanceToken,
    acceptPersonalAuth: params.acceptPersonalAuth,
  });

  if (String(source.status).toUpperCase() !== 'AVAILABLE') {
    throw new BillingError(
      `Wompi payment source status is ${source.status}`,
      'WOMPI_SOURCE_UNAVAILABLE'
    );
  }

  const paymentMethodId = await persistPaymentMethod(supabase, {
    userId: params.userId,
    email: params.email,
    sourceId: source.id,
    paymentType: params.paymentType,
    tokenMeta: {
      ...params.tokenMeta,
      lastFour:
        params.tokenMeta?.lastFour ||
        (source.publicData?.last_four as string | undefined),
      phoneLast4:
        params.tokenMeta?.phoneLast4 ||
        (typeof source.publicData?.phone_number === 'string'
          ? String(source.publicData.phone_number).slice(-4)
          : undefined),
    },
  });

  const subscription = await resolveSubscriptionRow(
    supabase,
    params.userId,
    params.plan.id,
    reference
  );

  await supabase.from('billing_invoices').insert({
    user_id: params.userId,
    subscription_id: subscription.id,
    provider: 'wompi',
    provider_invoice_id: reference,
    amount_cents: amountInCents,
    currency: 'COP',
    status: 'open',
    issued_at: new Date().toISOString(),
  });

  const isCard = params.paymentType === 'CARD';
  const tx = await wompi.createSourceTransaction({
    amountInCents,
    currency: 'COP',
    customerEmail: params.email,
    reference,
    paymentSourceId: source.id,
    installments: isCard ? 1 : undefined,
    recurrent: isCard ? true : undefined,
  });

  const settled = await wompi.waitForTransactionStatus(tx.id, {
    timeoutMs: 8000,
    intervalMs: 1000,
  });

  const mapped = mapTxStatus(settled.status);

  if (mapped === 'active') {
    await activateFirstCharge(supabase, {
      userId: params.userId,
      subscriptionId: subscription.id,
      plan: params.plan,
      reference,
      transactionId: settled.id,
      amountInCents: settled.amountInCents || amountInCents,
      email: params.email,
      locale: params.locale,
      emailSender: params.emailSender,
    });

    return {
      subscriptionId: subscription.id,
      providerSubscriptionId: reference,
      status: 'active',
      transactionStatus: 'APPROVED',
      paymentMethodId,
      transactionId: settled.id,
    };
  }

  if (mapped === 'declined' || mapped === 'error') {
    await supabase
      .from('billing_invoices')
      .update({
        status: 'uncollectible',
        updated_at: new Date().toISOString(),
      })
      .eq('provider_invoice_id', reference);

    return {
      subscriptionId: subscription.id,
      providerSubscriptionId: reference,
      status: 'incomplete',
      transactionStatus: settled.status,
      paymentMethodId,
      transactionId: settled.id,
    };
  }

  // PENDING — webhook will activate
  return {
    subscriptionId: subscription.id,
    providerSubscriptionId: reference,
    status: 'incomplete',
    transactionStatus: 'PENDING',
    paymentMethodId,
    transactionId: settled.id,
  };
}

export async function activateFirstCharge(
  supabase: SupabaseClient,
  params: {
    userId: string;
    subscriptionId: string;
    plan: PlanDefinition;
    reference: string;
    transactionId: string;
    amountInCents: number;
    email: string;
    locale?: string | null;
    emailSender?: BillingEmailSender;
  }
): Promise<void> {
  const paidAt = new Date();
  const periodEnd = extendPeriodEnd(paidAt, params.plan.interval);
  const nowIso = paidAt.toISOString();

  await supabase
    .from('billing_subscriptions')
    .update({
      status: 'active',
      plan_id: params.plan.id,
      provider_subscription_id: params.reference,
      current_period_start: nowIso,
      current_period_end: periodEnd.toISOString(),
      cancel_at_period_end: false,
      updated_at: nowIso,
    })
    .eq('id', params.subscriptionId);

  const { data: invoice } = await supabase
    .from('billing_invoices')
    .select('id')
    .eq('provider_invoice_id', params.reference)
    .maybeSingle();

  if (invoice?.id) {
    await supabase
      .from('billing_invoices')
      .update({
        status: 'paid',
        paid_at: nowIso,
        amount_cents: params.amountInCents,
        updated_at: nowIso,
      })
      .eq('id', invoice.id);
  } else {
    await supabase.from('billing_invoices').insert({
      user_id: params.userId,
      subscription_id: params.subscriptionId,
      provider: 'wompi',
      provider_invoice_id: params.reference,
      amount_cents: params.amountInCents,
      currency: 'COP',
      status: 'paid',
      issued_at: nowIso,
      paid_at: nowIso,
    });
  }

  const sender = params.emailSender ?? getBillingEmailSender();
  await sendBillingEmailOnce(supabase, sender, 'renewal_success', {
    userId: params.userId,
    subscriptionId: params.subscriptionId,
    email: params.email,
    locale: params.locale,
    periodKey: `${toPeriodEndYmd(periodEnd)}:first`,
    planName: params.plan.name,
  });
}

/**
 * Replace default Wompi payment method; void previous source; charge if past_due.
 */
export async function replaceWompiPaymentMethod(
  supabase: SupabaseClient,
  wompi: WompiAdapter,
  params: ReplaceWompiPaymentMethodParams
): Promise<{
  paymentMethodId: string;
  pastDueCharge?: { charged: boolean; status?: string; message?: string };
}> {
  const source = await wompi.createPaymentSource({
    type: params.paymentType,
    token: params.paymentToken,
    customerEmail: params.email,
    acceptanceToken: params.acceptanceToken,
    acceptPersonalAuth: params.acceptPersonalAuth,
  });

  if (String(source.status).toUpperCase() !== 'AVAILABLE') {
    throw new BillingError(
      `Wompi payment source status is ${source.status}`,
      'WOMPI_SOURCE_UNAVAILABLE'
    );
  }

  const { data: oldMethods } = await supabase
    .from('billing_payment_methods')
    .select('id, provider_payment_source_id')
    .eq('user_id', params.userId)
    .eq('provider', 'wompi')
    .is('voided_at', null);

  const paymentMethodId = await persistPaymentMethod(supabase, {
    userId: params.userId,
    email: params.email,
    sourceId: source.id,
    paymentType: params.paymentType,
    tokenMeta: {
      ...params.tokenMeta,
      lastFour:
        params.tokenMeta?.lastFour ||
        (source.publicData?.last_four as string | undefined),
      phoneLast4:
        params.tokenMeta?.phoneLast4 ||
        (typeof source.publicData?.phone_number === 'string'
          ? String(source.publicData.phone_number).slice(-4)
          : undefined),
    },
  });

  for (const old of oldMethods || []) {
    if (old.id === paymentMethodId) continue;
    if (old.provider_payment_source_id) {
      try {
        await wompi.voidPaymentSource(old.provider_payment_source_id as string);
      } catch (err) {
        console.warn('Failed to void old Wompi payment source', err);
      }
    }
    await supabase
      .from('billing_payment_methods')
      .update({
        voided_at: new Date().toISOString(),
        is_default: false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', old.id);
  }

  const pastDueCharge = await chargeWompiPastDueNow(
    supabase,
    wompi,
    params.userId,
    params.emailSender
  );

  return { paymentMethodId, pastDueCharge };
}
