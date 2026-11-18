/**
 * Wompi first purchase + payment method management (KAN-166).
 * Card tokenization happens in the browser; this module only receives tokens.
 *
 * First-charge idempotency: claim billing_renewal_attempts BEFORE calling Wompi
 * with a deterministic reference keyed by subscription id.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { WompiAdapter } from './adapters/wompi.adapter';
import type { PlanDefinition, CreateSubscriptionResponse, SubscriptionStatus } from './types';
import { BillingError } from './types';
import { resolveWompiAmountInCents } from './wompi-pricing';
import {
  buildWompiFirstReference,
  FIRST_CHARGE_PERIOD_SENTINEL,
  toPeriodEndYmd,
} from './wompi-references';
import { CLAIM_STALE_MS, extendPeriodEnd } from './dunning';
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
  phoneLast4?: string;
}

export interface CreateWompiSourceAndSubscribeParams {
  userId: string;
  plan: PlanDefinition;
  email: string;
  locale?: string | null;
  paymentType: 'CARD' | 'NEQUI';
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

type SubSnapshot = {
  id: string;
  status: string;
  current_period_end: string | null;
  plan_id: string;
  billing_anchor_day?: number | null;
};

async function findBlockingSubscription(
  supabase: SupabaseClient,
  userId: string
): Promise<SubSnapshot | null> {
  const { data } = await supabase
    .from('billing_subscriptions')
    .select('id, status, current_period_end, plan_id, billing_anchor_day')
    .eq('user_id', userId)
    .eq('provider', 'wompi')
    .in('status', ['active', 'past_due'])
    .order('created_at', { ascending: false })
    .limit(3);

  for (const row of data || []) {
    const end = row.current_period_end
      ? new Date(row.current_period_end as string).getTime()
      : null;
    if (row.status === 'active' || row.status === 'past_due') {
      if (end == null || end > Date.now()) {
        return row as SubSnapshot;
      }
    }
  }
  return null;
}

async function getOrCreateIncompleteSubscription(
  supabase: SupabaseClient,
  userId: string,
  planId: string
): Promise<SubSnapshot> {
  const { data: existing } = await supabase
    .from('billing_subscriptions')
    .select('id, status, current_period_end, plan_id, billing_anchor_day')
    .eq('user_id', userId)
    .eq('provider', 'wompi')
    .eq('status', 'incomplete')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    if (existing.plan_id !== planId) {
      await supabase
        .from('billing_subscriptions')
        .update({ plan_id: planId, updated_at: new Date().toISOString() })
        .eq('id', existing.id);
    }
    return { ...(existing as SubSnapshot), plan_id: planId };
  }

  const { data: created, error } = await supabase
    .from('billing_subscriptions')
    .insert({
      user_id: userId,
      plan_id: planId,
      status: 'incomplete',
      provider: 'wompi',
      provider_subscription_id: `wompi_pending_${userId}_${Date.now()}`,
      cancel_at_period_end: false,
    })
    .select('id, status, current_period_end, plan_id, billing_anchor_day')
    .single();

  if (error || !created) {
    throw new BillingError(
      'Failed to create Wompi subscription',
      'CREATE_SUBSCRIPTION_FAILED'
    );
  }

  return created as SubSnapshot;
}

async function markAttemptStatus(
  supabase: SupabaseClient,
  reference: string,
  fromStatuses: string[],
  patch: Record<string, unknown>
): Promise<boolean> {
  const { data } = await supabase
    .from('billing_renewal_attempts')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('wompi_reference', reference)
    .in('status', fromStatuses)
    .select('id')
    .maybeSingle();
  return !!data?.id;
}

/**
 * Create payment source + first charge. Claim-before-charge; refuse if already entitled.
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
    alreadyActive?: boolean;
  }
> {
  const blocking = await findBlockingSubscription(supabase, params.userId);
  if (blocking) {
    return {
      subscriptionId: blocking.id,
      providerSubscriptionId: blocking.id,
      status: blocking.status as SubscriptionStatus,
      transactionStatus: 'APPROVED',
      alreadyActive: true,
    };
  }

  const amountInCents = resolveWompiAmountInCents(
    params.plan.id,
    params.plan.providerPriceMap?.wompi
  );

  const subscription = await getOrCreateIncompleteSubscription(
    supabase,
    params.userId,
    params.plan.id
  );

  const reference = buildWompiFirstReference(
    params.userId,
    params.plan.id,
    subscription.id
  );

  // Existing in-flight / approved first-charge attempt?
  const { data: existingAttempt } = await supabase
    .from('billing_renewal_attempts')
    .select('*')
    .eq('subscription_id', subscription.id)
    .eq('period_end', FIRST_CHARGE_PERIOD_SENTINEL)
    .eq('attempt_number', 1)
    .maybeSingle();

  if (existingAttempt) {
    if (existingAttempt.status === 'approved') {
      return {
        subscriptionId: subscription.id,
        providerSubscriptionId: reference,
        status: 'active',
        transactionStatus: 'APPROVED',
        transactionId: existingAttempt.wompi_transaction_id as string | undefined,
        alreadyActive: true,
      };
    }

    if (
      existingAttempt.status === 'claimed' ||
      existingAttempt.status === 'pending'
    ) {
      // Reconcile in-flight; never create a second charge
      if (existingAttempt.wompi_transaction_id) {
        const tx = await wompi.getTransaction(
          existingAttempt.wompi_transaction_id as string
        );
        const mapped = mapTxStatus(tx.status);
        if (mapped === 'active') {
          await activateFirstCharge(supabase, {
            userId: params.userId,
            subscriptionId: subscription.id,
            plan: params.plan,
            reference,
            transactionId: tx.id,
            amountInCents: tx.amountInCents || amountInCents,
            email: params.email,
            locale: params.locale,
            emailSender: params.emailSender,
          });
          return {
            subscriptionId: subscription.id,
            providerSubscriptionId: reference,
            status: 'active',
            transactionStatus: 'APPROVED',
            transactionId: tx.id,
          };
        }
        return {
          subscriptionId: subscription.id,
          providerSubscriptionId: reference,
          status: 'incomplete',
          transactionStatus: tx.status,
          transactionId: tx.id,
        };
      }

      const claimedAt = new Date(
        (existingAttempt.claimed_at as string) || Date.now()
      ).getTime();
      if (Date.now() - claimedAt < CLAIM_STALE_MS) {
        return {
          subscriptionId: subscription.id,
          providerSubscriptionId: reference,
          status: 'incomplete',
          transactionStatus: 'PENDING',
        };
      }

      // Stale claim without tx — try lookup by reference, else mark error and continue
      try {
        const found = await wompi.findTransactionByReference(reference);
        if (found) {
          await markAttemptStatus(supabase, reference, ['claimed', 'pending'], {
            status: 'pending',
            wompi_transaction_id: found.id,
          });
          const mapped = mapTxStatus(found.status);
          if (mapped === 'active') {
            await activateFirstCharge(supabase, {
              userId: params.userId,
              subscriptionId: subscription.id,
              plan: params.plan,
              reference,
              transactionId: found.id,
              amountInCents: found.amountInCents || amountInCents,
              email: params.email,
              locale: params.locale,
              emailSender: params.emailSender,
            });
            return {
              subscriptionId: subscription.id,
              providerSubscriptionId: reference,
              status: 'active',
              transactionStatus: 'APPROVED',
              transactionId: found.id,
            };
          }
          return {
            subscriptionId: subscription.id,
            providerSubscriptionId: reference,
            status: 'incomplete',
            transactionStatus: found.status,
            transactionId: found.id,
          };
        }
      } catch (err) {
        console.warn('First-charge reference lookup failed', err);
      }

      await markAttemptStatus(supabase, reference, ['claimed', 'pending'], {
        status: 'error',
        error_message: 'Stale claim without transaction',
        finalized_at: new Date().toISOString(),
      });
      // Fall through to create a NEW incomplete sub + new attempt after error
      // (unique on subscription+sentinel+1 is taken) — create fresh incomplete row
      const { data: fresh } = await supabase
        .from('billing_subscriptions')
        .insert({
          user_id: params.userId,
          plan_id: params.plan.id,
          status: 'incomplete',
          provider: 'wompi',
          provider_subscription_id: `wompi_pending_${params.userId}_${Date.now()}`,
          cancel_at_period_end: false,
        })
        .select('id, status, current_period_end, plan_id, billing_anchor_day')
        .single();

      if (!fresh) {
        throw new BillingError(
          'Failed to recreate subscription after stale claim',
          'CREATE_SUBSCRIPTION_FAILED'
        );
      }
      Object.assign(subscription, fresh);
    }
    // declined/error → allow new attempt only via new subscription (handled above for stale)
    if (existingAttempt.status === 'declined' || existingAttempt.status === 'error') {
      // Unique constraint blocks same sub — create new incomplete
      const { data: fresh } = await supabase
        .from('billing_subscriptions')
        .insert({
          user_id: params.userId,
          plan_id: params.plan.id,
          status: 'incomplete',
          provider: 'wompi',
          provider_subscription_id: `wompi_pending_${params.userId}_${Date.now()}`,
          cancel_at_period_end: false,
        })
        .select('id, status, current_period_end, plan_id, billing_anchor_day')
        .single();
      if (fresh) Object.assign(subscription, fresh);
    }
  }

  const finalReference = buildWompiFirstReference(
    params.userId,
    params.plan.id,
    subscription.id
  );

  // Claim BEFORE payment source / charge
  const { error: claimError } = await supabase.from('billing_renewal_attempts').insert({
    subscription_id: subscription.id,
    user_id: params.userId,
    period_end: FIRST_CHARGE_PERIOD_SENTINEL,
    attempt_number: 1,
    status: 'claimed',
    wompi_reference: finalReference,
    amount_cents: amountInCents,
    currency: 'COP',
  });

  if (claimError) {
    // Concurrent claim — return in-flight state
    return {
      subscriptionId: subscription.id,
      providerSubscriptionId: finalReference,
      status: 'incomplete',
      transactionStatus: 'PENDING',
    };
  }

  await supabase
    .from('billing_subscriptions')
    .update({
      provider_subscription_id: finalReference,
      updated_at: new Date().toISOString(),
    })
    .eq('id', subscription.id);

  const source = await wompi.createPaymentSource({
    type: params.paymentType,
    token: params.paymentToken,
    customerEmail: params.email,
    acceptanceToken: params.acceptanceToken,
    acceptPersonalAuth: params.acceptPersonalAuth,
  });

  if (String(source.status).toUpperCase() !== 'AVAILABLE') {
    await markAttemptStatus(supabase, finalReference, ['claimed'], {
      status: 'error',
      error_message: `Source status ${source.status}`,
      finalized_at: new Date().toISOString(),
    });
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

  await supabase.from('billing_invoices').insert({
    user_id: params.userId,
    subscription_id: subscription.id,
    provider: 'wompi',
    provider_invoice_id: finalReference,
    amount_cents: amountInCents,
    currency: 'COP',
    status: 'open',
    issued_at: new Date().toISOString(),
  });

  const isCard = params.paymentType === 'CARD';
  let tx;
  try {
    tx = await wompi.createSourceTransaction({
      amountInCents,
      currency: 'COP',
      customerEmail: params.email,
      reference: finalReference,
      paymentSourceId: source.id,
      installments: isCard ? 1 : undefined,
      recurrent: isCard ? true : undefined,
    });
  } catch (err) {
    await markAttemptStatus(supabase, finalReference, ['claimed'], {
      status: 'error',
      error_message: err instanceof Error ? err.message : 'Charge failed',
      finalized_at: new Date().toISOString(),
    });
    throw err;
  }

  // CAS: only claimed → pending (never overwrite approved)
  await markAttemptStatus(supabase, finalReference, ['claimed'], {
    status: 'pending',
    wompi_transaction_id: tx.id,
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
      reference: finalReference,
      transactionId: settled.id,
      amountInCents: settled.amountInCents || amountInCents,
      email: params.email,
      locale: params.locale,
      emailSender: params.emailSender,
    });

    return {
      subscriptionId: subscription.id,
      providerSubscriptionId: finalReference,
      status: 'active',
      transactionStatus: 'APPROVED',
      paymentMethodId,
      transactionId: settled.id,
    };
  }

  if (mapped === 'declined' || mapped === 'error') {
    await markAttemptStatus(supabase, finalReference, ['claimed', 'pending'], {
      status: mapped === 'error' ? 'error' : 'declined',
      wompi_transaction_id: settled.id,
      finalized_at: new Date().toISOString(),
    });
    await supabase
      .from('billing_invoices')
      .update({
        status: 'uncollectible',
        updated_at: new Date().toISOString(),
      })
      .eq('provider_invoice_id', finalReference);

    return {
      subscriptionId: subscription.id,
      providerSubscriptionId: finalReference,
      status: 'incomplete',
      transactionStatus: settled.status,
      paymentMethodId,
      transactionId: settled.id,
    };
  }

  return {
    subscriptionId: subscription.id,
    providerSubscriptionId: finalReference,
    status: 'incomplete',
    transactionStatus: 'PENDING',
    paymentMethodId,
    transactionId: settled.id,
  };
}

/**
 * Activate first charge idempotently. No-op if already active with future period.
 * Period math runs at most once (CAS on attempt → approved).
 */
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
): Promise<{ activated: boolean }> {
  const { data: sub } = await supabase
    .from('billing_subscriptions')
    .select('id, status, current_period_end, billing_anchor_day')
    .eq('id', params.subscriptionId)
    .maybeSingle();

  if (
    sub?.status === 'active' &&
    sub.current_period_end &&
    new Date(sub.current_period_end as string).getTime() > Date.now()
  ) {
    // Still mark attempt approved if needed (CAS)
    await markAttemptStatus(supabase, params.reference, ['claimed', 'pending'], {
      status: 'approved',
      wompi_transaction_id: params.transactionId,
      finalized_at: new Date().toISOString(),
    });
    await persistPaidInvoice(supabase, params);
    return { activated: false };
  }

  // CAS attempt first — period extension exactly once
  const casOk = await markAttemptStatus(
    supabase,
    params.reference,
    ['claimed', 'pending'],
    {
      status: 'approved',
      wompi_transaction_id: params.transactionId,
      finalized_at: new Date().toISOString(),
    }
  );

  // If no attempt row (legacy) or already approved, still guard subscription update
  if (!casOk) {
    const { data: attempt } = await supabase
      .from('billing_renewal_attempts')
      .select('status')
      .eq('wompi_reference', params.reference)
      .maybeSingle();
    if (attempt?.status === 'approved') {
      await persistPaidInvoice(supabase, params);
      return { activated: false };
    }
  }

  const paidAt = new Date();
  const anchorDay = paidAt.getUTCDate();
  const periodEnd = extendPeriodEnd(paidAt, params.plan.interval, anchorDay);
  const nowIso = paidAt.toISOString();

  // Only promote incomplete/past_due → active (don't rewrite an already-future active)
  const { data: updated } = await supabase
    .from('billing_subscriptions')
    .update({
      status: 'active',
      plan_id: params.plan.id,
      provider_subscription_id: params.reference,
      current_period_start: nowIso,
      current_period_end: periodEnd.toISOString(),
      billing_anchor_day: anchorDay,
      updated_at: nowIso,
    })
    .eq('id', params.subscriptionId)
    .in('status', ['incomplete', 'past_due', 'trialing', 'unpaid'])
    .select('id')
    .maybeSingle();

  // Also allow active with expired period
  if (!updated) {
    await supabase
      .from('billing_subscriptions')
      .update({
        status: 'active',
        plan_id: params.plan.id,
        provider_subscription_id: params.reference,
        current_period_start: nowIso,
        current_period_end: periodEnd.toISOString(),
        billing_anchor_day: anchorDay,
        updated_at: nowIso,
      })
      .eq('id', params.subscriptionId)
      .eq('status', 'active')
      .lt('current_period_end', nowIso);
  }

  await persistPaidInvoice(supabase, params);

  const sender = params.emailSender ?? getBillingEmailSender();
  if (params.email) {
    await sendBillingEmailOnce(supabase, sender, 'renewal_success', {
      userId: params.userId,
      subscriptionId: params.subscriptionId,
      email: params.email,
      locale: params.locale,
      periodKey: `${toPeriodEndYmd(periodEnd)}:first:${params.subscriptionId}`,
      planName: params.plan.name,
    });
  }

  return { activated: true };
}

async function persistPaidInvoice(
  supabase: SupabaseClient,
  params: {
    userId: string;
    subscriptionId: string;
    reference: string;
    amountInCents: number;
  }
): Promise<void> {
  const nowIso = new Date().toISOString();
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
