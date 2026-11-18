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
import {
  CLAIM_STALE_MS,
  extendPeriodEnd,
  hasPaidEntitlement,
} from './dunning';
import {
  getBillingEmailSender,
  sendBillingEmailOnce,
  type BillingEmailSender,
} from './billing-emails';
import { chargeWompiPastDueNow } from './renewals';
import { isDefinitiveWompiChargeRejection } from './types';
import {
  acquireChargeLease,
  refreshChargeLease,
  releaseChargeLease,
} from './charge-leases';

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

/**
 * Block a new first purchase while any Wompi active/past_due exists.
 * Expired `active` past grace may be permanently tombstoned
 * (canceled_reason=expired_resubscribe) when safe.
 */
export async function findBlockingSubscription(
  supabase: SupabaseClient,
  userId: string
): Promise<SubSnapshot | null> {
  const { data } = await supabase
    .from('billing_subscriptions')
    .select(
      'id, status, current_period_end, plan_id, billing_anchor_day, canceled_reason'
    )
    .eq('user_id', userId)
    .eq('provider', 'wompi')
    .in('status', ['active', 'past_due'])
    .order('created_at', { ascending: false })
    .limit(5);

  for (const row of data || []) {
    if (row.status === 'past_due') {
      return row as SubSnapshot;
    }

    if (
      hasPaidEntitlement({
        status: 'active',
        currentPeriodEnd: row.current_period_end as string | null,
      })
    ) {
      return row as SubSnapshot;
    }

    // Expired active past grace — never tombstone while open charge or
    // entitlement-bearing approval for this period still exists.
    const { data: openAttempts } = await supabase
      .from('billing_renewal_attempts')
      .select('id, status, requires_refund')
      .eq('subscription_id', row.id)
      .in('status', ['claimed', 'pending', 'approved'])
      .limit(10);

    const blocksTombstone = (openAttempts || []).some(
      a =>
        a.status === 'claimed' ||
        a.status === 'pending' ||
        (a.status === 'approved' && a.requires_refund !== true)
    );

    if (blocksTombstone) {
      return row as SubSnapshot;
    }

    const nowIso = new Date().toISOString();
    const { data: tombstoned } = await supabase
      .from('billing_subscriptions')
      .update({
        status: 'canceled',
        canceled_at: nowIso,
        cancel_at_period_end: true,
        canceled_reason: 'expired_resubscribe',
        updated_at: nowIso,
      })
      .eq('id', row.id)
      .eq('status', 'active')
      .select('id')
      .maybeSingle();

    if (!tombstoned?.id) {
      return row as SubSnapshot;
    }
  }
  return null;
}

async function getOrCreateIncompleteSubscription(
  supabase: SupabaseClient,
  userId: string,
  planId: string
): Promise<SubSnapshot> {
  // Cancel stray incompletes except the newest (unique index allows one)
  const { data: incompletes } = await supabase
    .from('billing_subscriptions')
    .select('id, status, current_period_end, plan_id, billing_anchor_day')
    .eq('user_id', userId)
    .eq('provider', 'wompi')
    .eq('status', 'incomplete')
    .order('created_at', { ascending: false });

  if (incompletes && incompletes.length > 1) {
    const keep = incompletes[0];
    const nowIso = new Date().toISOString();
    for (const orphan of incompletes.slice(1)) {
      await supabase
        .from('billing_subscriptions')
        .update({
          status: 'canceled',
          canceled_at: nowIso,
          canceled_reason: 'superseded',
          updated_at: nowIso,
        })
        .eq('id', orphan.id)
        .eq('status', 'incomplete');
    }
    if (keep.plan_id !== planId) {
      await supabase
        .from('billing_subscriptions')
        .update({ plan_id: planId, updated_at: nowIso })
        .eq('id', keep.id);
    }
    return { ...(keep as SubSnapshot), plan_id: planId };
  }

  if (incompletes?.[0]?.id) {
    const existing = incompletes[0];
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

  if (error?.code === '23505') {
    throw new BillingError(
      'A Wompi subscription purchase is already in progress',
      'WOMPI_SUBSCRIBE_IN_PROGRESS'
    );
  }

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
    message?: string;
  }
> {
  const leaseHolder = `first:${params.userId}:${Date.now()}`;
  const leased = await acquireChargeLease(supabase, params.userId, leaseHolder);
  if (!leased) {
    throw new BillingError(
      'A Wompi charge is already in progress for this account',
      'WOMPI_SUBSCRIBE_IN_PROGRESS'
    );
  }

  try {
    return await createWompiSourceAndSubscribeLocked(
      supabase,
      wompi,
      params,
      leaseHolder
    );
  } finally {
    await releaseChargeLease(supabase, params.userId, leaseHolder);
  }
}

async function createWompiSourceAndSubscribeLocked(
  supabase: SupabaseClient,
  wompi: WompiAdapter,
  params: CreateWompiSourceAndSubscribeParams,
  leaseHolder: string
): Promise<
  CreateSubscriptionResponse & {
    transactionStatus: string;
    paymentMethodId?: string;
    transactionId?: string;
    alreadyActive?: boolean;
    message?: string;
  }
> {
  // Re-validate under lease
  const blocking = await findBlockingSubscription(supabase, params.userId);
  if (blocking) {
    if (blocking.status === 'past_due') {
      return {
        subscriptionId: blocking.id,
        providerSubscriptionId: blocking.id,
        status: 'past_due',
        transactionStatus: 'REQUIRES_PAYMENT_METHOD',
        alreadyActive: false,
        message:
          'Your subscription is past due. Update your payment method to retry the charge.',
      };
    }
    // Only claim alreadyActive when the live row is actually active
    if (blocking.status === 'active') {
      return {
        subscriptionId: blocking.id,
        providerSubscriptionId: blocking.id,
        status: 'active',
        transactionStatus: 'APPROVED',
        alreadyActive: true,
      };
    }
    return {
      subscriptionId: blocking.id,
      providerSubscriptionId: blocking.id,
      status: blocking.status as SubscriptionStatus,
      transactionStatus: 'PENDING',
      alreadyActive: false,
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

  // Latest first-charge attempt for this incomplete subscription (attempt counter)
  const { data: priorFirstAttempts } = await supabase
    .from('billing_renewal_attempts')
    .select('*')
    .eq('subscription_id', subscription.id)
    .eq('period_end', FIRST_CHARGE_PERIOD_SENTINEL)
    .order('attempt_number', { ascending: false })
    .limit(1);

  const existingAttempt = priorFirstAttempts?.[0] ?? null;
  let nextAttemptNumber = 1;

  if (existingAttempt) {
    const attemptRef =
      (existingAttempt.wompi_reference as string) ||
      buildWompiFirstReference(
        params.userId,
        params.plan.id,
        subscription.id,
        existingAttempt.attempt_number as number
      );

    if (existingAttempt.status === 'approved') {
      // Heal approved-but-not-promoted (crash between approve and activate)
      if (existingAttempt.requires_refund !== true) {
        const refreshed = await refreshChargeLease(
          supabase,
          params.userId,
          leaseHolder
        );
        if (!refreshed) {
          throw new BillingError(
            'A Wompi charge is already in progress for this account',
            'WOMPI_SUBSCRIBE_IN_PROGRESS'
          );
        }
        await activateFirstChargeLocked(supabase, {
          userId: params.userId,
          subscriptionId: subscription.id,
          plan: params.plan,
          reference: attemptRef,
          transactionId:
            (existingAttempt.wompi_transaction_id as string) || attemptRef,
          amountInCents: amountInCents,
          email: params.email,
          locale: params.locale,
          emailSender: params.emailSender,
        });
      }

      const { data: liveAfterHeal } = await supabase
        .from('billing_subscriptions')
        .select('id, status, current_period_end')
        .eq('id', subscription.id)
        .maybeSingle();

      if (
        liveAfterHeal?.status === 'active' &&
        hasPaidEntitlement({
          status: 'active',
          currentPeriodEnd: liveAfterHeal.current_period_end as string | null,
        })
      ) {
        return {
          subscriptionId: subscription.id,
          providerSubscriptionId: attemptRef,
          status: 'active',
          transactionStatus: 'APPROVED',
          transactionId: existingAttempt.wompi_transaction_id as string | undefined,
          alreadyActive: true,
        };
      }

      return {
        subscriptionId: subscription.id,
        providerSubscriptionId: attemptRef,
        status: (liveAfterHeal?.status as SubscriptionStatus) || 'incomplete',
        transactionStatus: 'APPROVED',
        transactionId: existingAttempt.wompi_transaction_id as string | undefined,
        alreadyActive: false,
        message:
          existingAttempt.requires_refund === true
            ? 'Payment approved but requires manual refund review'
            : 'Payment approved; subscription activation pending',
      };
    }

    if (
      existingAttempt.status === 'claimed' ||
      existingAttempt.status === 'pending'
    ) {
      // Reconcile in-flight; never create a second charge for the same attempt
      if (existingAttempt.wompi_transaction_id) {
        const tx = await wompi.getTransaction(
          existingAttempt.wompi_transaction_id as string
        );
        const mapped = mapTxStatus(tx.status);
        if (mapped === 'active') {
          await activateFirstChargeLocked(supabase, {
            userId: params.userId,
            subscriptionId: subscription.id,
            plan: params.plan,
            reference: attemptRef,
            transactionId: tx.id,
            amountInCents: tx.amountInCents || amountInCents,
            email: params.email,
            locale: params.locale,
            emailSender: params.emailSender,
          });
          return {
            subscriptionId: subscription.id,
            providerSubscriptionId: attemptRef,
            status: 'active',
            transactionStatus: 'APPROVED',
            transactionId: tx.id,
          };
        }
        if (mapped === 'declined' || mapped === 'error') {
          await markAttemptStatus(supabase, attemptRef, ['claimed', 'pending'], {
            status: mapped === 'error' ? 'error' : 'declined',
            wompi_transaction_id: tx.id,
            finalized_at: new Date().toISOString(),
          });
          nextAttemptNumber = (existingAttempt.attempt_number as number) + 1;
        } else {
          return {
            subscriptionId: subscription.id,
            providerSubscriptionId: attemptRef,
            status: 'incomplete',
            transactionStatus: tx.status,
            transactionId: tx.id,
          };
        }
      } else {
        const claimedAt = new Date(
          (existingAttempt.claimed_at as string) || Date.now()
        ).getTime();
        if (Date.now() - claimedAt < CLAIM_STALE_MS) {
          return {
            subscriptionId: subscription.id,
            providerSubscriptionId: attemptRef,
            status: 'incomplete',
            transactionStatus: 'PENDING',
          };
        }

        const lookup = await wompi.findTransactionByReference(attemptRef);

        if (lookup.kind === 'found') {
          const found = lookup.transaction;
          await markAttemptStatus(
            supabase,
            attemptRef,
            ['claimed', 'pending', 'error'],
            {
              status: 'pending',
              wompi_transaction_id: found.id,
            }
          );
          const mapped = mapTxStatus(found.status);
          if (mapped === 'active') {
            await activateFirstChargeLocked(supabase, {
              userId: params.userId,
              subscriptionId: subscription.id,
              plan: params.plan,
              reference: attemptRef,
              transactionId: found.id,
              amountInCents: found.amountInCents || amountInCents,
              email: params.email,
              locale: params.locale,
              emailSender: params.emailSender,
            });
            return {
              subscriptionId: subscription.id,
              providerSubscriptionId: attemptRef,
              status: 'active',
              transactionStatus: 'APPROVED',
              transactionId: found.id,
            };
          }
          if (mapped === 'declined' || mapped === 'error') {
            await markAttemptStatus(supabase, attemptRef, ['claimed', 'pending'], {
              status: mapped === 'error' ? 'error' : 'declined',
              wompi_transaction_id: found.id,
              finalized_at: new Date().toISOString(),
            });
            nextAttemptNumber = (existingAttempt.attempt_number as number) + 1;
          } else {
            return {
              subscriptionId: subscription.id,
              providerSubscriptionId: attemptRef,
              status: 'incomplete',
              transactionStatus: found.status,
              transactionId: found.id,
            };
          }
        } else if (lookup.kind === 'error') {
          console.warn(
            'First-charge reference lookup inconclusive; keeping attempt open',
            {
              reference: attemptRef,
              httpStatus: lookup.httpStatus,
              message: lookup.message,
            }
          );
          return {
            subscriptionId: subscription.id,
            providerSubscriptionId: attemptRef,
            status: 'incomplete',
            transactionStatus: 'PENDING',
          };
        } else {
          // empty + past stale threshold → safe to abandon this attempt
          await markAttemptStatus(supabase, attemptRef, ['claimed', 'pending'], {
            status: 'error',
            error_message: 'Stale claim: reference lookup returned empty',
            finalized_at: new Date().toISOString(),
          });
          nextAttemptNumber = (existingAttempt.attempt_number as number) + 1;
        }
      }
    } else if (
      existingAttempt.status === 'declined' ||
      existingAttempt.status === 'error'
    ) {
      nextAttemptNumber = (existingAttempt.attempt_number as number) + 1;
    }
  }

  const finalReference = buildWompiFirstReference(
    params.userId,
    params.plan.id,
    subscription.id,
    nextAttemptNumber
  );

  // Claim BEFORE payment source / charge
  const { error: claimError } = await supabase.from('billing_renewal_attempts').insert({
    subscription_id: subscription.id,
    user_id: params.userId,
    period_end: FIRST_CHARGE_PERIOD_SENTINEL,
    attempt_number: nextAttemptNumber,
    status: 'claimed',
    wompi_reference: finalReference,
    amount_cents: amountInCents,
    currency: 'COP',
  });

  if (claimError) {
    // Concurrent claim on this attempt number — surface as error, not fake PENDING
    // when we expected a fresh row after declined/error.
    if (existingAttempt?.status === 'declined' || existingAttempt?.status === 'error') {
      throw new BillingError(
        'Failed to open a fresh first-charge attempt after prior decline',
        'FIRST_CHARGE_RETRY_CLAIM_FAILED'
      );
    }
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
  const leaseOkBeforeCharge = await refreshChargeLease(
    supabase,
    params.userId,
    leaseHolder
  );
  if (!leaseOkBeforeCharge) {
    throw new BillingError(
      'A Wompi charge is already in progress for this account',
      'WOMPI_SUBSCRIBE_IN_PROGRESS'
    );
  }

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
    const message = err instanceof Error ? err.message : 'Charge failed';
    if (isDefinitiveWompiChargeRejection(err)) {
      // 4xx validation — no transaction created
      await markAttemptStatus(supabase, finalReference, ['claimed'], {
        status: 'error',
        error_message: message,
        finalized_at: new Date().toISOString(),
      });
    } else {
      // Network / 5xx / unknown — leave claimed for stale-claim reconciliation
      await markAttemptStatus(supabase, finalReference, ['claimed'], {
        error_message: message,
      });
    }
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
    const leaseOkBeforeActivate = await refreshChargeLease(
      supabase,
      params.userId,
      leaseHolder
    );
    if (!leaseOkBeforeActivate) {
      throw new BillingError(
        'A Wompi charge is already in progress for this account',
        'WOMPI_SUBSCRIBE_IN_PROGRESS'
      );
    }

    await activateFirstChargeLocked(supabase, {
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

    const { data: liveSub } = await supabase
      .from('billing_subscriptions')
      .select('status')
      .eq('id', subscription.id)
      .maybeSingle();

    return {
      subscriptionId: subscription.id,
      providerSubscriptionId: finalReference,
      status: (liveSub?.status as SubscriptionStatus) || 'incomplete',
      transactionStatus: 'APPROVED',
      paymentMethodId,
      transactionId: settled.id,
      alreadyActive: liveSub?.status === 'active',
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

type ActivateFirstChargeParams = {
  userId: string;
  subscriptionId: string;
  plan: PlanDefinition;
  reference: string;
  transactionId: string;
  amountInCents: number;
  email: string;
  locale?: string | null;
  emailSender?: BillingEmailSender;
};

export type ActivateFirstChargeResult = {
  activated: boolean;
  /** Entitlement not applied; webhook/cron should retry (5xx / re-run). */
  retryable?: boolean;
};

/**
 * Activate first charge idempotently. No-op if already active with future period.
 * Heals approved-but-still-incomplete on every call (webhook redelivery / cron).
 * Acquires a per-user charge lease (webhook / external callers).
 * Throws BillingError WOMPI_LEASE_CONTENTION / WOMPI_ACTIVATION_RETRY so webhooks 5xx.
 */
export async function activateFirstCharge(
  supabase: SupabaseClient,
  params: ActivateFirstChargeParams
): Promise<ActivateFirstChargeResult> {
  const leaseHolder = `activate:${params.userId}:${params.reference}`;
  const leased = await acquireChargeLease(supabase, params.userId, leaseHolder);
  if (!leased) {
    throw new BillingError(
      'Charge lease contention during first-charge activation',
      'WOMPI_LEASE_CONTENTION'
    );
  }
  try {
    const refreshed = await refreshChargeLease(
      supabase,
      params.userId,
      leaseHolder
    );
    if (!refreshed) {
      throw new BillingError(
        'Charge lease lost during first-charge activation',
        'WOMPI_LEASE_CONTENTION'
      );
    }
    const result = await activateFirstChargeLocked(supabase, params);
    if (result.retryable) {
      throw new BillingError(
        'First-charge activation not applied — retry',
        'WOMPI_ACTIVATION_RETRY'
      );
    }
    return result;
  } finally {
    await releaseChargeLease(supabase, params.userId, leaseHolder);
  }
}

/** Activation writes under an already-held lease (subscribe path). */
async function activateFirstChargeLocked(
  supabase: SupabaseClient,
  params: ActivateFirstChargeParams
): Promise<ActivateFirstChargeResult> {
  const { data: sub } = await supabase
    .from('billing_subscriptions')
    .select('id, status, current_period_end, billing_anchor_day')
    .eq('id', params.subscriptionId)
    .maybeSingle();

  const alreadyActive =
    sub?.status === 'active' &&
    sub.current_period_end &&
    new Date(sub.current_period_end as string).getTime() > Date.now();

  if (alreadyActive) {
    const { data: existingAttempt } = await supabase
      .from('billing_renewal_attempts')
      .select('status, requires_refund')
      .eq('wompi_reference', params.reference)
      .maybeSingle();

    if (existingAttempt?.status === 'approved') {
      // Idempotent redelivery of the activating payment
      await persistPaidInvoice(supabase, params);
      return { activated: false };
    }

    // Extra APPROVED (different attempt) while sub already active — flag refund
    await markAttemptStatus(
      supabase,
      params.reference,
      ['claimed', 'pending', 'error'],
      {
        status: 'approved',
        wompi_transaction_id: params.transactionId,
        finalized_at: new Date().toISOString(),
        requires_refund: true,
        refund_reason:
          'Subscription already active from another first-charge approval',
      }
    );
    await persistPaidInvoice(supabase, params);
    console.error(
      `[billing] First-charge APPROVED but sub already active — manual refund required`,
      { reference: params.reference, subscriptionId: params.subscriptionId }
    );
    return { activated: false };
  }

  // CAS attempt first — heal error → approved
  const casOk = await markAttemptStatus(
    supabase,
    params.reference,
    ['claimed', 'pending', 'error'],
    {
      status: 'approved',
      wompi_transaction_id: params.transactionId,
      finalized_at: new Date().toISOString(),
    }
  );

  let alreadyApproved = false;

  if (!casOk) {
    const { data: attempt } = await supabase
      .from('billing_renewal_attempts')
      .select('status, requires_refund')
      .eq('wompi_reference', params.reference)
      .maybeSingle();

    if (attempt?.status === 'approved') {
      if (attempt.requires_refund === true) {
        await persistPaidInvoice(supabase, params);
        return { activated: false };
      }
      // Heal: approved but subscription never promoted
      alreadyApproved = true;
    } else if (attempt) {
      // Terminal declined/error or unexpected race — do not promote subscription
      return { activated: false };
    }
    // Legacy: no attempt row (web-checkout era) — continue
  }

  // Refuse promote when another chargeable Wompi sub already exists
  const { data: chargeablePeers } = await supabase
    .from('billing_subscriptions')
    .select('id, status')
    .eq('user_id', params.userId)
    .eq('provider', 'wompi')
    .in('status', ['active', 'past_due'])
    .neq('id', params.subscriptionId)
    .limit(1);

  if (chargeablePeers && chargeablePeers.length > 0) {
    const nowIso = new Date().toISOString();
    await supabase
      .from('billing_renewal_attempts')
      .update({
        requires_refund: true,
        refund_reason: `Another chargeable Wompi subscription exists (${chargeablePeers[0].id})`,
        updated_at: nowIso,
      })
      .eq('wompi_reference', params.reference)
      .eq('status', 'approved');
    await persistPaidInvoice(supabase, params);
    console.error(
      `[billing] First-charge APPROVED but another chargeable sub exists — manual refund required`,
      { reference: params.reference, subscriptionId: params.subscriptionId }
    );
    return { activated: false };
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
      canceled_reason: null,
      cancel_at_period_end: false,
      updated_at: nowIso,
    })
    .eq('id', params.subscriptionId)
    .in('status', ['incomplete', 'past_due', 'trialing', 'unpaid'])
    .select('id')
    .maybeSingle();

  let activated = !!updated?.id;

  // Also allow active with expired period
  if (!activated) {
    const { data: renewed } = await supabase
      .from('billing_subscriptions')
      .update({
        status: 'active',
        plan_id: params.plan.id,
        provider_subscription_id: params.reference,
        current_period_start: nowIso,
        current_period_end: periodEnd.toISOString(),
        billing_anchor_day: anchorDay,
        canceled_reason: null,
        cancel_at_period_end: false,
        updated_at: nowIso,
      })
      .eq('id', params.subscriptionId)
      .eq('status', 'active')
      .lt('current_period_end', nowIso)
      .select('id')
      .maybeSingle();
    activated = !!renewed?.id;
  }

  if (!activated && (casOk || alreadyApproved)) {
    // Re-read — another path may have activated concurrently
    const { data: live } = await supabase
      .from('billing_subscriptions')
      .select('status, current_period_end')
      .eq('id', params.subscriptionId)
      .maybeSingle();

    if (
      live?.status === 'active' &&
      live.current_period_end &&
      new Date(live.current_period_end as string).getTime() > Date.now()
    ) {
      await persistPaidInvoice(supabase, params);
      return { activated: false };
    }

    // Transient failure — leave approved, ask caller to retry (do not refund yet)
    await persistPaidInvoice(supabase, params);
    console.error(
      `[billing] First-charge APPROVED but subscription not yet active — retry activation`,
      { reference: params.reference, subscriptionId: params.subscriptionId }
    );
    return { activated: false, retryable: true };
  }

  await persistPaidInvoice(supabase, params);

  if (activated) {
    await cancelOrphanIncompleteSubscriptions(
      supabase,
      params.userId,
      params.subscriptionId
    );

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
  }

  return { activated };
}

/**
 * Cron/webhook heal: approved first-charge attempts whose sub is still not
 * active/past_due and not refund-flagged → promote under lease (or flag refund).
 */
export async function reconcileApprovedFirstCharges(
  supabase: SupabaseClient,
  options: {
    limit?: number;
    emailSender?: BillingEmailSender;
    deadlineMs?: number;
  } = {}
): Promise<{ healed: number; refundFlagged: number; errors: number }> {
  const limit = options.limit ?? 50;
  const deadlineMs = options.deadlineMs ?? Date.now() + 60_000;
  const summary = { healed: 0, refundFlagged: 0, errors: 0 };

  const { data: attempts, error } = await supabase
    .from('billing_renewal_attempts')
    .select(
      'wompi_reference, wompi_transaction_id, subscription_id, user_id, amount_cents, requires_refund'
    )
    .eq('period_end', FIRST_CHARGE_PERIOD_SENTINEL)
    .eq('status', 'approved')
    .or('requires_refund.is.null,requires_refund.eq.false')
    .order('claimed_at', { ascending: true })
    .limit(limit);

  if (error) {
    console.error('[billing] reconcileApprovedFirstCharges query failed', error);
    summary.errors++;
    return summary;
  }

  for (const attempt of attempts || []) {
    if (Date.now() >= deadlineMs) break;

    const { data: sub } = await supabase
      .from('billing_subscriptions')
      .select('id, status, plan_id, current_period_end')
      .eq('id', attempt.subscription_id)
      .maybeSingle();

    if (!sub) continue;
    if (sub.status === 'active' || sub.status === 'past_due') continue;

    const { data: planRow } = await supabase
      .from('billing_plans')
      .select(
        'id, name, currency, amount_cents, interval, features, provider_price_map'
      )
      .eq('id', sub.plan_id)
      .maybeSingle();

    if (!planRow) {
      summary.errors++;
      continue;
    }

    const plan: PlanDefinition = {
      id: planRow.id as string,
      name: planRow.name as string,
      currency: (planRow.currency as PlanDefinition['currency']) || 'USD',
      amountCents: (planRow.amount_cents as number) || 0,
      interval: (planRow.interval as PlanDefinition['interval']) || 'month',
      features: (planRow.features as PlanDefinition['features']) || {
        max_assets: -1,
        max_beneficiaries: 10,
        max_file_size_mb: 100,
        max_storage_mb: 5000,
        priority_support: true,
        advanced_security: true,
      },
      providerPriceMap: planRow.provider_price_map as PlanDefinition['providerPriceMap'],
    };

    const { data: user } = await supabase
      .from('users')
      .select('email')
      .eq('id', attempt.user_id)
      .maybeSingle();

    try {
      const result = await activateFirstCharge(supabase, {
        userId: attempt.user_id as string,
        subscriptionId: attempt.subscription_id as string,
        plan,
        reference: attempt.wompi_reference as string,
        transactionId:
          (attempt.wompi_transaction_id as string) ||
          (attempt.wompi_reference as string),
        amountInCents: (attempt.amount_cents as number) || 0,
        email: (user?.email as string) || '',
        emailSender: options.emailSender,
      });
      if (result.activated) summary.healed++;
      else {
        const { data: att } = await supabase
          .from('billing_renewal_attempts')
          .select('requires_refund')
          .eq('wompi_reference', attempt.wompi_reference)
          .maybeSingle();
        if (att?.requires_refund === true) summary.refundFlagged++;
      }
    } catch (err) {
      console.error(
        '[billing] reconcileApprovedFirstCharges heal failed',
        err instanceof Error ? err.message : err
      );
      summary.errors++;
    }
  }

  return summary;
}

export async function cancelOrphanIncompleteSubscriptions(
  supabase: SupabaseClient,
  userId: string,
  keepSubscriptionId: string
): Promise<void> {
  const nowIso = new Date().toISOString();
  await supabase
    .from('billing_subscriptions')
    .update({
      status: 'canceled',
      canceled_at: nowIso,
      canceled_reason: 'superseded',
      updated_at: nowIso,
    })
    .eq('user_id', userId)
    .eq('provider', 'wompi')
    .eq('status', 'incomplete')
    .neq('id', keepSubscriptionId);
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
