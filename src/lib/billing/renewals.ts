/**
 * Wompi nightly renewals + dunning (KAN-166).
 *
 * Idempotency: insert renewal attempt BEFORE calling Wompi.
 * Status transitions are compare-and-set (never approved→pending).
 * Claimed-without-tx: after 15m lookup by reference or mark error.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { WompiAdapter } from './adapters/wompi.adapter';
import { BillingError, isDefinitiveWompiChargeRejection } from './types';
import { resolveWompiAmountInCents } from './wompi-pricing';
import {
  buildWompiRenewalReference,
  FIRST_CHARGE_PERIOD_SENTINEL,
  toPeriodEndYmd,
} from './wompi-references';
import {
  CLAIM_STALE_MS,
  extendPeriodEnd,
  getDueDunningAttempt,
  isPastFinalDunningDay,
  MAX_DUNNING_ATTEMPTS,
  sameInstant,
  UPCOMING_RENEWAL_DAYS,
} from './dunning';
import {
  getBillingEmailSender,
  sendBillingEmailOnce,
  type BillingEmailSender,
} from './billing-emails';
import {
  acquireChargeLease,
  refreshChargeLease,
  releaseChargeLease,
} from './charge-leases';

/** Durable marker when approved but requires_refund flag write failed */
export const REQUIRES_REFUND_FLAG_PENDING = 'REQUIRES_REFUND_FLAG_PENDING';

export interface RenewalRunSummary {
  scanned: number;
  charged: number;
  reconciled: number;
  approved: number;
  failed: number;
  downgraded: number;
  canceledAtPeriodEnd: number;
  upcomingEmails: number;
  skipped: number;
  batches: number;
  errors: Array<{ subscriptionId: string; message: string }>;
}

export interface ProcessRenewalsOptions {
  now?: Date;
  batchSize?: number;
  /** Wall-clock budget for multi-batch processing (default 240s). */
  timeBudgetMs?: number;
  emailSender?: BillingEmailSender;
}

type SubRow = {
  id: string;
  user_id: string;
  plan_id: string;
  status: string;
  cancel_at_period_end: boolean;
  current_period_end: string | null;
  current_period_start: string | null;
  billing_anchor_day?: number | null;
  provider: string;
};

type AttemptRow = {
  id: string;
  subscription_id: string;
  user_id: string;
  period_end: string;
  attempt_number: number;
  wompi_reference: string;
  wompi_transaction_id: string | null;
  amount_cents: number | null;
  status: string;
  claimed_at?: string;
};

function formatCop(amountInCents: number): string {
  const pesos = Math.round(amountInCents / 100);
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(pesos);
}

async function getUserEmail(
  supabase: SupabaseClient,
  userId: string
): Promise<{ email: string; locale?: string | null } | null> {
  const { data } = await supabase
    .from('users')
    .select('email')
    .eq('id', userId)
    .maybeSingle();

  if (!data?.email) return null;
  // No stored locale on users; Wompi/Colombia default is ES (billing-emails).
  return { email: data.email as string, locale: 'es' };
}

async function getPlanMeta(
  supabase: SupabaseClient,
  planId: string
): Promise<{
  name: string;
  interval: 'month' | 'year';
  provider_price_map?: Record<string, string> | null;
} | null> {
  const { data } = await supabase
    .from('billing_plans')
    .select('name, interval, provider_price_map')
    .eq('id', planId)
    .maybeSingle();
  if (!data) return null;
  return data as {
    name: string;
    interval: 'month' | 'year';
    provider_price_map?: Record<string, string> | null;
  };
}

async function getDefaultPaymentSource(
  supabase: SupabaseClient,
  userId: string
): Promise<{
  id: string;
  provider_payment_source_id: string;
  method_type: string | null;
} | null> {
  const { data } = await supabase
    .from('billing_payment_methods')
    .select('id, provider_payment_source_id, method_type')
    .eq('user_id', userId)
    .eq('provider', 'wompi')
    .eq('is_default', true)
    .is('voided_at', null)
    .maybeSingle();

  if (!data?.provider_payment_source_id) return null;
  return data as {
    id: string;
    provider_payment_source_id: string;
    method_type: string | null;
  };
}

/** Compare-and-set attempt status. Returns true if a row was updated. */
export async function casAttemptStatus(
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

async function persistPaidRenewalInvoice(
  supabase: SupabaseClient,
  sub: SubRow,
  reference: string,
  amountCents: number,
  nowIso: string
): Promise<void> {
  const { error: invError } = await supabase.from('billing_invoices').upsert(
    {
      user_id: sub.user_id,
      subscription_id: sub.id,
      provider: 'wompi',
      provider_invoice_id: reference,
      amount_cents: amountCents,
      currency: 'COP',
      status: 'paid',
      issued_at: nowIso,
      paid_at: nowIso,
      updated_at: nowIso,
    },
    { onConflict: 'provider_invoice_id', ignoreDuplicates: false }
  );

  if (invError) {
    const { data: existing } = await supabase
      .from('billing_invoices')
      .select('id')
      .eq('provider_invoice_id', reference)
      .maybeSingle();
    if (existing?.id) {
      await supabase
        .from('billing_invoices')
        .update({
          status: 'paid',
          paid_at: nowIso,
          amount_cents: amountCents,
          updated_at: nowIso,
        })
        .eq('id', existing.id);
    } else {
      await supabase.from('billing_invoices').insert({
        user_id: sub.user_id,
        subscription_id: sub.id,
        provider: 'wompi',
        provider_invoice_id: reference,
        amount_cents: amountCents,
        currency: 'COP',
        status: 'paid',
        issued_at: nowIso,
        paid_at: nowIso,
      });
    }
  }
}

/**
 * Exactly-once period extension: CAS current_period_end = attempt.period_end.
 * Allows active/past_due, or canceled-by-dunning when no other chargeable sub exists.
 */
async function casApplyPeriodExtension(
  supabase: SupabaseClient,
  sub: SubRow,
  periodEnd: string,
  planInterval: 'month' | 'year'
): Promise<{ applied: boolean; reason?: string }> {
  const previousEnd = new Date(periodEnd);
  const anchor = sub.billing_anchor_day ?? previousEnd.getUTCDate();
  const newEnd = extendPeriodEnd(previousEnd, planInterval, anchor);
  const nowIso = new Date().toISOString();

  const patch = {
    status: 'active',
    current_period_start: previousEnd.toISOString(),
    current_period_end: newEnd.toISOString(),
    billing_anchor_day: anchor,
    canceled_at: null,
    updated_at: nowIso,
  };

  // Path 1: still entitled / in dunning
  const { data: fromLive, error: liveError } = await supabase
    .from('billing_subscriptions')
    .update(patch)
    .eq('id', sub.id)
    .eq('current_period_end', periodEnd)
    .in('status', ['active', 'past_due'])
    .select('id')
    .maybeSingle();

  if (liveError?.code === '23505') {
    return {
      applied: false,
      reason: 'Unique chargeable Wompi subscription conflict (23505)',
    };
  }

  if (fromLive?.id) {
    return { applied: true };
  }

  // Path 2: only dunning-canceled may reactivate; never tombstones/user cancels
  const { data: otherSubs } = await supabase
    .from('billing_subscriptions')
    .select('id, status')
    .eq('user_id', sub.user_id)
    .eq('provider', 'wompi')
    .in('status', ['active', 'past_due', 'incomplete'])
    .neq('id', sub.id)
    .limit(5);

  if (otherSubs && otherSubs.length > 0) {
    return {
      applied: false,
      reason: `Another Wompi subscription exists (${otherSubs[0].status}:${otherSubs[0].id})`,
    };
  }

  const { data: openFirst } = await supabase
    .from('billing_renewal_attempts')
    .select('id, status, requires_refund')
    .eq('user_id', sub.user_id)
    .eq('period_end', FIRST_CHARGE_PERIOD_SENTINEL)
    .in('status', ['claimed', 'pending', 'approved'])
    .limit(5);

  const blocksPath2 = (openFirst || []).some(
    a =>
      a.status === 'claimed' ||
      a.status === 'pending' ||
      (a.status === 'approved' && a.requires_refund !== true)
  );

  if (blocksPath2) {
    return {
      applied: false,
      reason: 'Open or approved first-charge attempt exists for user',
    };
  }

  const reactivatePatch = {
    ...patch,
    canceled_reason: null as string | null,
    cancel_at_period_end: false,
  };

  const { data: fromDunning, error: dunningError } = await supabase
    .from('billing_subscriptions')
    .update(reactivatePatch)
    .eq('id', sub.id)
    .eq('current_period_end', periodEnd)
    .eq('status', 'canceled')
    .eq('canceled_reason', 'dunning')
    .select('id')
    .maybeSingle();

  if (dunningError?.code === '23505') {
    return {
      applied: false,
      reason: 'Unique chargeable Wompi subscription conflict (23505)',
    };
  }

  if (fromDunning?.id) {
    return { applied: true };
  }

  // Reload to explain
  const { data: current } = await supabase
    .from('billing_subscriptions')
    .select('status, current_period_end, cancel_at_period_end, canceled_reason')
    .eq('id', sub.id)
    .maybeSingle();

  if (
    current?.current_period_end &&
    !sameInstant(current.current_period_end, periodEnd)
  ) {
    return {
      applied: false,
      reason: `Period already extended (current_period_end=${current.current_period_end})`,
    };
  }

  if (current?.status === 'canceled') {
    return {
      applied: false,
      reason: `Canceled not reactivatable (reason=${current.canceled_reason ?? 'unknown'})`,
    };
  }

  return {
    applied: false,
    reason: `Cannot apply period extension (status=${current?.status ?? 'missing'})`,
  };
}

/**
 * Durably mark attempt approved + requires_refund. Retries; on failure leaves
 * the attempt claimed so reconciliation can retry. Never reports success if
 * the flag was not written.
 */
async function approveAttemptRequiresRefundDurable(
  supabase: SupabaseClient,
  reference: string,
  transactionId: string,
  reason: string,
  nowIso: string
): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const casOk = await casAttemptStatus(
      supabase,
      reference,
      ['claimed', 'pending', 'error'],
      {
        status: 'approved',
        wompi_transaction_id: transactionId,
        finalized_at: nowIso,
        requires_refund: true,
        refund_reason: reason,
      }
    );
    if (casOk) return true;

    const { data: row } = await supabase
      .from('billing_renewal_attempts')
      .select('status, requires_refund')
      .eq('wompi_reference', reference)
      .maybeSingle();

    if (row?.status === 'approved' && row.requires_refund === true) {
      return true;
    }

    if (row?.status === 'approved') {
      const { data: flagged } = await supabase
        .from('billing_renewal_attempts')
        .update({
          requires_refund: true,
          refund_reason: reason,
          wompi_transaction_id: transactionId,
          updated_at: nowIso,
        })
        .eq('wompi_reference', reference)
        .eq('status', 'approved')
        .select('id, requires_refund')
        .maybeSingle();
      if (flagged?.requires_refund === true) return true;
    }
  }

  console.error(
    `[billing] CRITICAL: could not durably set requires_refund — leaving attempt claimed for retry`,
    { reference, reason }
  );
  return false;
}

async function markAttemptAppliedAt(
  supabase: SupabaseClient,
  reference: string
): Promise<boolean> {
  const nowIso = new Date().toISOString();
  const { data } = await supabase
    .from('billing_renewal_attempts')
    .update({
      applied_at: nowIso,
      updated_at: nowIso,
      error_message: null,
    })
    .eq('wompi_reference', reference)
    .eq('status', 'approved')
    .is('applied_at', null)
    .select('id, applied_at')
    .maybeSingle();
  if (data?.applied_at) return true;

  const { data: row } = await supabase
    .from('billing_renewal_attempts')
    .select('applied_at')
    .eq('wompi_reference', reference)
    .maybeSingle();
  return !!row?.applied_at;
}

/**
 * Heal approved renewal whose period entitlement was never stamped (applied_at).
 * Under lease: extend if still on attempt.period_end; stamp applied_at if already
 * extended to the expected next end; else requires_refund.
 */
export async function healApprovedRenewalAttempt(
  supabase: SupabaseClient,
  params: {
    reference: string;
    transactionId?: string;
    amountCents?: number;
    emailSender?: BillingEmailSender;
  }
): Promise<{ healed: boolean; refunded: boolean; retryable?: boolean }> {
  const emailSender = params.emailSender ?? getBillingEmailSender();
  const { data: attempt } = await supabase
    .from('billing_renewal_attempts')
    .select('*')
    .eq('wompi_reference', params.reference)
    .maybeSingle();

  if (!attempt || attempt.status !== 'approved') {
    return { healed: false, refunded: false };
  }
  if (attempt.requires_refund === true) {
    return { healed: false, refunded: true };
  }
  if (attempt.applied_at) {
    return { healed: true, refunded: false };
  }

  // First-charge uses sentinel period — not a renewal heal
  if (attempt.period_end === FIRST_CHARGE_PERIOD_SENTINEL) {
    return { healed: false, refunded: false };
  }

  const { data: sub } = await supabase
    .from('billing_subscriptions')
    .select('*')
    .eq('id', attempt.subscription_id)
    .maybeSingle();

  if (!sub) {
    return { healed: false, refunded: false, retryable: true };
  }

  const plan = await getPlanMeta(supabase, sub.plan_id as string);
  const planInterval = plan?.interval || 'month';
  const periodEnd = attempt.period_end as string;
  const liveEnd = sub.current_period_end as string | null;
  // CAS must use the exact DB timestamptz string, not a re-serialized form
  const casPeriodEnd =
    liveEnd && sameInstant(liveEnd, periodEnd) ? liveEnd : periodEnd;
  const anchor =
    (sub.billing_anchor_day as number | null) ??
    new Date(casPeriodEnd).getUTCDate();
  const expectedNewEnd = extendPeriodEnd(
    casPeriodEnd,
    planInterval,
    anchor
  ).toISOString();
  const nowIso = new Date().toISOString();
  const amountCents =
    params.amountCents || (attempt.amount_cents as number) || 0;
  const transactionId =
    params.transactionId ||
    (attempt.wompi_transaction_id as string) ||
    params.reference;

  if (sameInstant(liveEnd, periodEnd)) {
    const periodResult = await casApplyPeriodExtension(
      supabase,
      sub as SubRow,
      casPeriodEnd,
      planInterval
    );
    if (periodResult.applied) {
      await markAttemptAppliedAt(supabase, params.reference);
      await persistPaidRenewalInvoice(
        supabase,
        sub as SubRow,
        params.reference,
        amountCents,
        nowIso
      );
      const user = await getUserEmail(supabase, sub.user_id as string);
      if (user && plan) {
        await sendBillingEmailOnce(supabase, emailSender, 'renewal_success', {
          userId: sub.user_id as string,
          subscriptionId: sub.id as string,
          email: user.email,
          locale: user.locale,
          periodKey: `${toPeriodEndYmd(periodEnd)}:renewal_success`,
          planName: plan.name,
          amountLabel: formatCop(amountCents),
        });
      }
      return { healed: true, refunded: false };
    }

    // Still on attempt period_end but CAS failed — definitive conflict → refund;
    // otherwise leave for retry.
    const reason = periodResult.reason || 'Period entitlement CAS failed';
    const definitive =
      reason.includes('Another Wompi') ||
      reason.includes('Open or approved first-charge') ||
      reason.includes('Canceled not reactivatable') ||
      reason.includes('23505');
    if (!definitive) {
      return { healed: false, refunded: false, retryable: true };
    }
    // Fall through to refund with this reason
    const refundReason = reason;
    let flagged = false;
    for (let i = 0; i < 3; i++) {
      const { data: row } = await supabase
        .from('billing_renewal_attempts')
        .update({
          requires_refund: true,
          refund_reason: refundReason,
          wompi_transaction_id: transactionId,
          error_message: null,
          updated_at: new Date().toISOString(),
        })
        .eq('wompi_reference', params.reference)
        .eq('status', 'approved')
        .select('id, requires_refund')
        .maybeSingle();
      if (row?.requires_refund === true) {
        flagged = true;
        break;
      }
    }
    if (!flagged) {
      await supabase
        .from('billing_renewal_attempts')
        .update({
          error_message: REQUIRES_REFUND_FLAG_PENDING,
          refund_reason: refundReason,
          updated_at: new Date().toISOString(),
        })
        .eq('wompi_reference', params.reference)
        .eq('status', 'approved');
      return { healed: false, refunded: false, retryable: true };
    }
    await persistPaidRenewalInvoice(
      supabase,
      sub as SubRow,
      params.reference,
      amountCents,
      nowIso
    );
    console.error(
      `[billing] Approved renewal could not apply period — manual refund required`,
      { reference: params.reference, reason: refundReason }
    );
    return { healed: false, refunded: true };
  }

  // Already extended to the expected next period by this attempt (or equivalent)
  if (sameInstant(liveEnd, expectedNewEnd)) {
    await markAttemptAppliedAt(supabase, params.reference);
    await persistPaidRenewalInvoice(
      supabase,
      sub as SubRow,
      params.reference,
      amountCents,
      nowIso
    );
    return { healed: true, refunded: false };
  }

  // Period moved elsewhere — cannot safely claim this approval applied it
  const reason = `Approved renewal not applied (live_end=${liveEnd}, expected=${expectedNewEnd})`;
  let flagged = false;
  for (let i = 0; i < 3; i++) {
    const { data: row } = await supabase
      .from('billing_renewal_attempts')
      .update({
        requires_refund: true,
        refund_reason: reason,
        wompi_transaction_id: transactionId,
        error_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq('wompi_reference', params.reference)
      .eq('status', 'approved')
      .select('id, requires_refund')
      .maybeSingle();
    if (row?.requires_refund === true) {
      flagged = true;
      break;
    }
  }
  if (!flagged) {
    await supabase
      .from('billing_renewal_attempts')
      .update({
        error_message: REQUIRES_REFUND_FLAG_PENDING,
        refund_reason: reason,
        updated_at: new Date().toISOString(),
      })
      .eq('wompi_reference', params.reference)
      .eq('status', 'approved');
    return { healed: false, refunded: false, retryable: true };
  }
  await persistPaidRenewalInvoice(
    supabase,
    sub as SubRow,
    params.reference,
    amountCents,
    nowIso
  );
  console.error(
    `[billing] Approved renewal could not apply period — manual refund required`,
    { reference: params.reference, reason }
  );
  return { healed: false, refunded: true };
}

async function applyApprovedRenewal(
  supabase: SupabaseClient,
  sub: SubRow,
  periodEnd: string,
  amountCents: number,
  reference: string,
  transactionId: string,
  planInterval: 'month' | 'year',
  planName: string,
  emailSender: BillingEmailSender
): Promise<boolean> {
  // Another entitlement-bearing approval already claimed this period?
  const { data: approvedPeers } = await supabase
    .from('billing_renewal_attempts')
    .select('id, wompi_reference, requires_refund, applied_at')
    .eq('subscription_id', sub.id)
    .eq('period_end', periodEnd)
    .eq('status', 'approved')
    .neq('wompi_reference', reference);

  const duplicatePeriod = (approvedPeers || []).find(
    a => a.requires_refund !== true
  );

  const nowIso = new Date().toISOString();

  if (duplicatePeriod) {
    const reason = `Duplicate APPROVED for period; entitlement already applied via ${duplicatePeriod.wompi_reference}`;
    const durable = await approveAttemptRequiresRefundDurable(
      supabase,
      reference,
      transactionId,
      reason,
      nowIso
    );
    await persistPaidRenewalInvoice(supabase, sub, reference, amountCents, nowIso);
    if (!durable) {
      return false; // left claimed for reconciliation retry
    }
    console.error(
      `[billing] Duplicate Wompi APPROVED for same period — manual refund required`,
      { reference, periodEnd, subscriptionId: sub.id }
    );
    return true;
  }

  // CAS attempt → approved (heal error). Unique index enforces one non-refund approved/period.
  const { data: casRow, error: casError } = await supabase
    .from('billing_renewal_attempts')
    .update({
      status: 'approved',
      wompi_transaction_id: transactionId,
      finalized_at: nowIso,
      updated_at: nowIso,
    })
    .eq('wompi_reference', reference)
    .in('status', ['claimed', 'pending', 'error'])
    .select('id')
    .maybeSingle();

  if (casError?.code === '23505') {
    const durable = await approveAttemptRequiresRefundDurable(
      supabase,
      reference,
      transactionId,
      'Lost race for per-period approved slot',
      nowIso
    );
    await persistPaidRenewalInvoice(supabase, sub, reference, amountCents, nowIso);
    if (!durable) {
      return false;
    }
    console.error(
      `[billing] Per-period approved unique conflict — manual refund required`,
      { reference, periodEnd, subscriptionId: sub.id }
    );
    return true;
  }

  if (!casRow?.id) {
    const { data: attempt } = await supabase
      .from('billing_renewal_attempts')
      .select('status, requires_refund, applied_at')
      .eq('wompi_reference', reference)
      .maybeSingle();
    if (attempt?.status === 'approved') {
      if (attempt.requires_refund === true || attempt.applied_at) {
        return true;
      }
      // Approved but period never stamped — heal
      const heal = await healApprovedRenewalAttempt(supabase, {
        reference,
        transactionId,
        amountCents,
        emailSender,
      });
      if (heal.retryable) return false;
      return true;
    }
    return false;
  }

  const periodResult = await casApplyPeriodExtension(
    supabase,
    sub,
    periodEnd,
    planInterval
  );

  if (!periodResult.applied) {
    // May already be extended to expected end (race) — try heal before refunding
    const heal = await healApprovedRenewalAttempt(supabase, {
      reference,
      transactionId,
      amountCents,
      emailSender,
    });
    if (heal.healed) return true;
    if (heal.refunded) return true;
    if (heal.retryable) return false;

    const reason = periodResult.reason || 'Period entitlement CAS failed';
    // Never move approved → claimed (would free the per-period unique slot).
    let flagged = false;
    for (let i = 0; i < 3; i++) {
      const { data: row } = await supabase
        .from('billing_renewal_attempts')
        .update({
          requires_refund: true,
          refund_reason: reason,
          error_message: null,
          updated_at: new Date().toISOString(),
        })
        .eq('wompi_reference', reference)
        .eq('status', 'approved')
        .select('id, requires_refund')
        .maybeSingle();
      if (row?.requires_refund === true) {
        flagged = true;
        break;
      }
    }

    if (!flagged) {
      await supabase
        .from('billing_renewal_attempts')
        .update({
          error_message: REQUIRES_REFUND_FLAG_PENDING,
          refund_reason: reason,
          updated_at: new Date().toISOString(),
        })
        .eq('wompi_reference', reference)
        .eq('status', 'approved');
      console.error(
        `[billing] CRITICAL: period CAS failed and requires_refund not written — left approved with ${REQUIRES_REFUND_FLAG_PENDING}`,
        { reference, reason }
      );
    } else {
      console.error(
        `[billing] Wompi APPROVED but entitlement not applied — manual refund required`,
        { reference, reason }
      );
    }

    await persistPaidRenewalInvoice(supabase, sub, reference, amountCents, nowIso);
    return true;
  }

  // Two-phase: stamp applied_at after durable period extension
  const stamped = await markAttemptAppliedAt(supabase, reference);
  if (!stamped) {
    console.error(
      `[billing] Period extended but applied_at not stamped — heal will retry`,
      { reference, periodEnd, subscriptionId: sub.id }
    );
  }

  await persistPaidRenewalInvoice(supabase, sub, reference, amountCents, nowIso);

  const user = await getUserEmail(supabase, sub.user_id);
  if (user) {
    await sendBillingEmailOnce(supabase, emailSender, 'renewal_success', {
      userId: sub.user_id,
      subscriptionId: sub.id,
      email: user.email,
      locale: user.locale,
      periodKey: `${toPeriodEndYmd(periodEnd)}:renewal_success`,
      planName,
      amountLabel: formatCop(amountCents),
    });
  }

  return true;
}

async function markAttemptFailed(
  supabase: SupabaseClient,
  reference: string,
  status: 'declined' | 'error',
  transactionId: string | null,
  message?: string
): Promise<void> {
  await casAttemptStatus(supabase, reference, ['claimed', 'pending'], {
    status,
    wompi_transaction_id: transactionId,
    error_message: message || null,
    finalized_at: new Date().toISOString(),
  });
}

async function setPastDue(
  supabase: SupabaseClient,
  subscriptionId: string,
  periodEnd?: string
): Promise<void> {
  let q = supabase
    .from('billing_subscriptions')
    .update({
      status: 'past_due',
      updated_at: new Date().toISOString(),
    })
    .eq('id', subscriptionId)
    .in('status', ['active', 'past_due', 'incomplete']);
  // When known, CAS on the exact live period so a concurrent extend cannot be clobbered
  if (periodEnd) {
    q = q.eq('current_period_end', periodEnd);
  }
  await q;
}

async function downgradeToFree(
  supabase: SupabaseClient,
  sub: SubRow,
  planName: string,
  emailSender: BillingEmailSender,
  periodEnd: string
): Promise<void> {
  const nowIso = new Date().toISOString();
  // CAS: only downgrade live chargeable rows still on this period
  const { data: downgraded } = await supabase
    .from('billing_subscriptions')
    .update({
      status: 'canceled',
      canceled_at: nowIso,
      cancel_at_period_end: false,
      canceled_reason: 'dunning',
      updated_at: nowIso,
    })
    .eq('id', sub.id)
    .eq('current_period_end', periodEnd)
    .in('status', ['active', 'past_due'])
    .select('id')
    .maybeSingle();

  if (!downgraded?.id) {
    return;
  }

  const user = await getUserEmail(supabase, sub.user_id);
  if (user) {
    await sendBillingEmailOnce(supabase, emailSender, 'downgrade_to_free', {
      userId: sub.user_id,
      subscriptionId: sub.id,
      email: user.email,
      locale: user.locale,
      periodKey: `${toPeriodEndYmd(periodEnd)}:downgrade`,
      planName,
    });
  }
}

export async function applyWompiRenewalApproval(
  supabase: SupabaseClient,
  params: {
    reference: string;
    transactionId: string;
    amountCents: number;
  },
  emailSender: BillingEmailSender = getBillingEmailSender()
): Promise<boolean> {
  const { data: attempt } = await supabase
    .from('billing_renewal_attempts')
    .select('*')
    .eq('wompi_reference', params.reference)
    .maybeSingle();

  if (!attempt) return false;

  // Fully done: applied or refund-flagged
  if (
    attempt.status === 'approved' &&
    (attempt.applied_at || attempt.requires_refund === true)
  ) {
    return true;
  }

  const leaseHolder = `approve:${attempt.user_id}:${params.reference}`;
  const leased = await acquireChargeLease(
    supabase,
    attempt.user_id as string,
    leaseHolder
  );
  if (!leased) {
    throw new BillingError(
      'Charge lease contention during renewal approval',
      'WOMPI_LEASE_CONTENTION'
    );
  }

  try {
    const refreshed = await refreshChargeLease(
      supabase,
      attempt.user_id as string,
      leaseHolder
    );
    if (!refreshed) {
      throw new BillingError(
        'Charge lease lost during renewal approval',
        'WOMPI_LEASE_CONTENTION'
      );
    }

    // Approved but period never stamped — heal (webhook redelivery / cron)
    if (attempt.status === 'approved' && !attempt.applied_at) {
      const heal = await healApprovedRenewalAttempt(supabase, {
        reference: params.reference,
        transactionId: params.transactionId,
        amountCents: params.amountCents,
        emailSender,
      });
      if (heal.retryable) {
        throw new BillingError(
          'Renewal approval heal not durably applied — retry',
          'WOMPI_APPROVAL_RETRY'
        );
      }
      return true;
    }

    const { data: sub } = await supabase
      .from('billing_subscriptions')
      .select('*')
      .eq('id', attempt.subscription_id)
      .maybeSingle();

    if (!sub) return false;

    const plan = await getPlanMeta(supabase, sub.plan_id as string);
    const ok = await applyApprovedRenewal(
      supabase,
      sub as SubRow,
      attempt.period_end as string,
      params.amountCents || (attempt.amount_cents as number) || 0,
      params.reference,
      params.transactionId,
      plan?.interval || 'month',
      plan?.name || 'Premium',
      emailSender
    );
    if (!ok) {
      // Durable refund flag could not be written while money moved — retry
      throw new BillingError(
        'Renewal approval not durably applied — retry',
        'WOMPI_APPROVAL_RETRY'
      );
    }
    return true;
  } finally {
    await releaseChargeLease(
      supabase,
      attempt.user_id as string,
      leaseHolder
    );
  }
}

export async function applyWompiRenewalFailure(
  supabase: SupabaseClient,
  params: {
    reference: string;
    transactionId: string;
    status: 'declined' | 'error';
    message?: string;
  },
  emailSender: BillingEmailSender = getBillingEmailSender()
): Promise<boolean> {
  const { data: attempt } = await supabase
    .from('billing_renewal_attempts')
    .select('*')
    .eq('wompi_reference', params.reference)
    .maybeSingle();

  if (!attempt) return false;

  // Already terminal — no side effects (no re-email, no early downgrade)
  if (
    attempt.status === 'approved' ||
    attempt.status === 'declined' ||
    attempt.status === 'error'
  ) {
    return true;
  }

  await markAttemptFailed(
    supabase,
    params.reference,
    params.status,
    params.transactionId,
    params.message
  );

  const { data: sub } = await supabase
    .from('billing_subscriptions')
    .select('*')
    .eq('id', attempt.subscription_id)
    .maybeSingle();

  if (!sub) return false;

  await setPastDue(
    supabase,
    sub.id as string,
    attempt.period_end as string
  );

  const plan = await getPlanMeta(supabase, sub.plan_id as string);
  const user = await getUserEmail(supabase, sub.user_id as string);
  if (user) {
    await sendBillingEmailOnce(supabase, emailSender, 'payment_failed', {
      userId: sub.user_id as string,
      subscriptionId: sub.id as string,
      email: user.email,
      locale: user.locale,
      periodKey: `${toPeriodEndYmd(attempt.period_end as string)}:fail:${attempt.attempt_number}`,
      planName: plan?.name,
      amountLabel: attempt.amount_cents
        ? formatCop(attempt.amount_cents as number)
        : undefined,
      nextRetryLabel:
        (attempt.attempt_number as number) < MAX_DUNNING_ATTEMPTS
          ? `attempt ${(attempt.attempt_number as number) + 1}`
          : undefined,
    });
  }

  // Downgrade only when finalizing the max dunning attempt (never on attempt 1–3
  // just because day ≥ 5 — that undoes the day-5 cron fix via webhook redelivery).
  if ((attempt.attempt_number as number) >= MAX_DUNNING_ATTEMPTS) {
    await downgradeToFree(
      supabase,
      sub as SubRow,
      plan?.name || 'Premium',
      emailSender,
      attempt.period_end as string
    );
  }

  return true;
}

async function reconcilePendingAttempt(
  supabase: SupabaseClient,
  wompi: WompiAdapter,
  attempt: AttemptRow,
  sub: SubRow,
  planName: string,
  planInterval: 'month' | 'year',
  emailSender: BillingEmailSender,
  now: Date
): Promise<'approved' | 'pending' | 'failed' | 'recovered_error'> {
  let txId = attempt.wompi_transaction_id;

  if (!txId) {
    const claimedAt = new Date(attempt.claimed_at || 0).getTime();
    const age = now.getTime() - claimedAt;

    if (age < CLAIM_STALE_MS) {
      return 'pending';
    }

    const lookup = await wompi.findTransactionByReference(attempt.wompi_reference);

    if (lookup.kind === 'found') {
      const found = lookup.transaction;
      await casAttemptStatus(
        supabase,
        attempt.wompi_reference,
        ['claimed', 'pending', 'error'],
        {
          status: 'pending',
          wompi_transaction_id: found.id,
        }
      );
      txId = found.id;
      const status = found.status.toUpperCase();
      if (status === 'APPROVED') {
        await applyApprovedRenewal(
          supabase,
          sub,
          attempt.period_end,
          found.amountInCents || attempt.amount_cents || 0,
          attempt.wompi_reference,
          found.id,
          planInterval,
          planName,
          emailSender
        );
        return 'approved';
      }
      if (status === 'DECLINED' || status === 'ERROR' || status === 'VOIDED') {
        await applyWompiRenewalFailure(
          supabase,
          {
            reference: attempt.wompi_reference,
            transactionId: found.id,
            status: status === 'ERROR' || status === 'VOIDED' ? 'error' : 'declined',
            message: `Wompi status ${status}`,
          },
          emailSender
        );
        return 'failed';
      }
      return 'pending';
    }

    if (lookup.kind === 'error') {
      // Undocumented endpoint / network / unexpected shape — keep claim open;
      // never open a new charge while a Wompi tx may still exist.
      console.warn(
        'Reference lookup inconclusive for stale claim; keeping attempt open',
        {
          reference: attempt.wompi_reference,
          httpStatus: lookup.httpStatus,
          message: lookup.message,
        }
      );
      return 'pending';
    }

    // kind === 'empty': HTTP 200 + data:[] and claim past stale threshold → safe to abandon
    await markAttemptFailed(
      supabase,
      attempt.wompi_reference,
      'error',
      null,
      'Stale claim: reference lookup returned empty'
    );
    return 'recovered_error';
  }

  const tx = await wompi.getTransaction(txId);
  const status = tx.status.toUpperCase();

  if (status === 'APPROVED') {
    await applyApprovedRenewal(
      supabase,
      sub,
      attempt.period_end,
      tx.amountInCents || attempt.amount_cents || 0,
      attempt.wompi_reference,
      tx.id,
      planInterval,
      planName,
      emailSender
    );
    return 'approved';
  }

  if (status === 'DECLINED' || status === 'ERROR' || status === 'VOIDED') {
    await applyWompiRenewalFailure(
      supabase,
      {
        reference: attempt.wompi_reference,
        transactionId: tx.id,
        status:
          status === 'ERROR' || status === 'VOIDED' ? 'error' : 'declined',
        message: `Wompi status ${status}`,
      },
      emailSender
    );
    return 'failed';
  }

  return 'pending';
}

async function processOneSubscription(
  supabase: SupabaseClient,
  wompi: WompiAdapter,
  sub: SubRow,
  now: Date,
  summary: RenewalRunSummary,
  emailSender: BillingEmailSender
): Promise<void> {
  if (!sub.current_period_end) {
    summary.skipped++;
    return;
  }

  const periodEnd = sub.current_period_end;
  const leaseHolder = `renew:${sub.id}:${periodEnd}`;
  const leased = await acquireChargeLease(supabase, sub.user_id, leaseHolder);
  if (!leased) {
    summary.skipped++;
    return;
  }

  try {
    // Live re-read under lease before cancel-at-period-end or charge
    const { data: live } = await supabase
      .from('billing_subscriptions')
      .select(
        'id, user_id, plan_id, status, cancel_at_period_end, current_period_end, current_period_start, billing_anchor_day, provider, canceled_reason'
      )
      .eq('id', sub.id)
      .maybeSingle();

    if (!live) {
      summary.skipped++;
      return;
    }

    const livePeriodEnd = live.current_period_end as string | null;
    if (!livePeriodEnd) {
      summary.skipped++;
      return;
    }

    // Already terminal / not chargeable — never cancel-or-charge from a stale batch row
    if (live.status !== 'active' && live.status !== 'past_due') {
      summary.skipped++;
      return;
    }

    const livePeriodMs = new Date(livePeriodEnd).getTime();
    if (
      live.cancel_at_period_end === true &&
      livePeriodMs <= now.getTime()
    ) {
      const nowIso = now.toISOString();
      // CAS: only cancel if still CAPE + matching period + still entitled status
      const { data: canceled } = await supabase
        .from('billing_subscriptions')
        .update({
          status: 'canceled',
          canceled_at: nowIso,
          canceled_reason: 'user',
          updated_at: nowIso,
        })
        .eq('id', live.id)
        .eq('cancel_at_period_end', true)
        .eq('current_period_end', livePeriodEnd)
        .in('status', ['active', 'past_due'])
        .select('id')
        .maybeSingle();

      if (canceled?.id) {
        summary.canceledAtPeriodEnd++;
      } else {
        // User resumed (CAPE cleared) or row already moved — no-op
        summary.skipped++;
      }
      return;
    }

    if (live.cancel_at_period_end === true) {
      summary.skipped++;
      return;
    }

    await processOneSubscriptionLocked(
      supabase,
      wompi,
      live as SubRow,
      now,
      summary,
      emailSender,
      livePeriodEnd,
      leaseHolder
    );
  } finally {
    await releaseChargeLease(supabase, sub.user_id, leaseHolder);
  }
}

async function retryRequiresRefundFlagPending(
  supabase: SupabaseClient,
  subscriptionId: string,
  periodEnd: string
): Promise<void> {
  const { data: rows } = await supabase
    .from('billing_renewal_attempts')
    .select('wompi_reference, refund_reason')
    .eq('subscription_id', subscriptionId)
    .eq('period_end', periodEnd)
    .eq('status', 'approved')
    .eq('error_message', REQUIRES_REFUND_FLAG_PENDING)
    .limit(5);

  for (const row of rows || []) {
    const { data: flagged } = await supabase
      .from('billing_renewal_attempts')
      .update({
        requires_refund: true,
        refund_reason:
          (row.refund_reason as string) || 'Period entitlement CAS failed',
        error_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq('wompi_reference', row.wompi_reference)
      .eq('status', 'approved')
      .select('id, requires_refund')
      .maybeSingle();
    if (flagged?.requires_refund === true) {
      console.error(
        `[billing] Retried requires_refund flag successfully`,
        { reference: row.wompi_reference }
      );
    }
  }
}

/**
 * Re-read live subscription under lease and charge only if still eligible.
 */
async function processOneSubscriptionLocked(
  supabase: SupabaseClient,
  wompi: WompiAdapter,
  batchSub: SubRow,
  now: Date,
  summary: RenewalRunSummary,
  emailSender: BillingEmailSender,
  periodEnd: string,
  leaseHolder: string
): Promise<void> {
  // Re-validate live row under lease
  const { data: live } = await supabase
    .from('billing_subscriptions')
    .select(
      'id, user_id, plan_id, status, cancel_at_period_end, current_period_end, current_period_start, billing_anchor_day, provider, canceled_reason'
    )
    .eq('id', batchSub.id)
    .maybeSingle();

  if (!live) {
    summary.skipped++;
    return;
  }

  const sub = live as SubRow;

  if (sub.status !== 'active' && sub.status !== 'past_due') {
    summary.skipped++;
    return;
  }
  if (sub.cancel_at_period_end) {
    summary.skipped++;
    return;
  }
  // Use exact live DB period string for subsequent CAS; compare by instant
  if (!sameInstant(sub.current_period_end, periodEnd)) {
    summary.skipped++;
    return;
  }
  const livePeriodEnd = (sub.current_period_end as string) || periodEnd;

  // Must still be the user's only chargeable sub
  const { data: chargeablePeers } = await supabase
    .from('billing_subscriptions')
    .select('id')
    .eq('user_id', sub.user_id)
    .eq('provider', 'wompi')
    .in('status', ['active', 'past_due'])
    .neq('id', sub.id)
    .limit(1);
  if (chargeablePeers && chargeablePeers.length > 0) {
    summary.skipped++;
    return;
  }

  await retryRequiresRefundFlagPending(supabase, sub.id, livePeriodEnd);

  const dueAttempt = getDueDunningAttempt(livePeriodEnd, now);
  if (dueAttempt == null) {
    summary.skipped++;
    return;
  }

  const plan = await getPlanMeta(supabase, sub.plan_id);
  if (!plan) {
    summary.errors.push({ subscriptionId: sub.id, message: 'Plan not found' });
    return;
  }

  const { data: pendingAttempts } = await supabase
    .from('billing_renewal_attempts')
    .select('*')
    .eq('subscription_id', sub.id)
    .eq('period_end', livePeriodEnd)
    .in('status', ['claimed', 'pending']);

  if (pendingAttempts && pendingAttempts.length > 0) {
    let stillBlocked = false;
    for (const attempt of pendingAttempts) {
      const result = await reconcilePendingAttempt(
        supabase,
        wompi,
        attempt as AttemptRow,
        sub,
        plan.name,
        plan.interval,
        emailSender,
        now
      );
      summary.reconciled++;
      if (result === 'approved') summary.approved++;
      if (result === 'failed') summary.failed++;
      if (result === 'pending') stillBlocked = true;
    }
    if (stillBlocked) {
      return;
    }
  }

  // Any APPROVED for this period (refund-flagged or not) — never open attempt N+1
  const { data: approvedRows } = await supabase
    .from('billing_renewal_attempts')
    .select('id, requires_refund, applied_at, wompi_reference, wompi_transaction_id, amount_cents')
    .eq('subscription_id', sub.id)
    .eq('period_end', livePeriodEnd)
    .eq('status', 'approved')
    .limit(5);

  const hasAppliedEntitlement = (approvedRows || []).some(
    a => a.requires_refund !== true && a.applied_at
  );

  if (hasAppliedEntitlement) {
    summary.skipped++;
    return;
  }

  // Heal approved-but-unapplied before hard-stop
  for (const row of approvedRows || []) {
    if (row.requires_refund === true || row.applied_at) continue;
    const heal = await healApprovedRenewalAttempt(supabase, {
      reference: row.wompi_reference as string,
      transactionId: (row.wompi_transaction_id as string) || undefined,
      amountCents: (row.amount_cents as number) || undefined,
      emailSender,
    });
    summary.reconciled++;
    if (heal.healed) {
      summary.approved++;
      return;
    }
    if (heal.retryable) {
      summary.skipped++;
      return;
    }
  }

  // Hard-stop: any APPROVED (including requires_refund) blocks further charges
  if (approvedRows && approvedRows.length > 0) {
    summary.skipped++;
    return;
  }

  const { data: priorAttempts } = await supabase
    .from('billing_renewal_attempts')
    .select('attempt_number, status')
    .eq('subscription_id', sub.id)
    .eq('period_end', livePeriodEnd)
    .order('attempt_number', { ascending: false });

  const highestDone = priorAttempts?.[0]?.attempt_number ?? 0;

  // Day-5+: run the final dunning attempt first; only downgrade after it has
  // finalized as declined/error (or on a later run if no new attempt is due).
  if (dueAttempt <= highestDone) {
    if (isPastFinalDunningDay(livePeriodEnd, now) && highestDone >= MAX_DUNNING_ATTEMPTS) {
      const final = priorAttempts?.find(
        a => a.attempt_number === MAX_DUNNING_ATTEMPTS
      );
      if (
        final &&
        (final.status === 'declined' || final.status === 'error')
      ) {
        await downgradeToFree(supabase, sub, plan.name, emailSender, livePeriodEnd);
        summary.downgraded++;
      } else {
        // Final attempt still claimed/pending (or missing) — wait / reconcile
        summary.skipped++;
      }
    } else {
      summary.skipped++;
    }
    return;
  }

  const attemptNumber = dueAttempt;
  const amountInCents = resolveWompiAmountInCents(
    sub.plan_id,
    plan.provider_price_map?.wompi
  );
  const reference = buildWompiRenewalReference(sub.id, livePeriodEnd, attemptNumber);

  const { error: claimError } = await supabase.from('billing_renewal_attempts').insert({
    subscription_id: sub.id,
    user_id: sub.user_id,
    period_end: livePeriodEnd,
    attempt_number: attemptNumber,
    status: 'claimed',
    wompi_reference: reference,
    amount_cents: amountInCents,
    currency: 'COP',
  });

  if (claimError) {
    summary.skipped++;
    return;
  }

  const pm = await getDefaultPaymentSource(supabase, sub.user_id);
  if (!pm) {
    await markAttemptFailed(supabase, reference, 'error', null, 'No payment method');
    await setPastDue(supabase, sub.id, livePeriodEnd);
    summary.failed++;
    if (attemptNumber >= MAX_DUNNING_ATTEMPTS || isPastFinalDunningDay(livePeriodEnd, now)) {
      await downgradeToFree(supabase, sub, plan.name, emailSender, livePeriodEnd);
      summary.downgraded++;
    }
    return;
  }

  const user = await getUserEmail(supabase, sub.user_id);
  if (!user?.email) {
    await markAttemptFailed(supabase, reference, 'error', null, 'User email missing');
    summary.failed++;
    return;
  }

  const isCard = (pm.method_type || 'CARD').toUpperCase() === 'CARD';

  const leaseBeforeCharge = await refreshChargeLease(
    supabase,
    sub.user_id,
    leaseHolder
  );
  if (!leaseBeforeCharge) {
    summary.skipped++;
    return;
  }

  try {
    const tx = await wompi.createSourceTransaction({
      amountInCents,
      currency: 'COP',
      customerEmail: user.email,
      reference,
      paymentSourceId: Number(pm.provider_payment_source_id),
      installments: isCard ? 1 : undefined,
      recurrent: isCard ? true : undefined,
    });

    const leaseAfterCharge = await refreshChargeLease(
      supabase,
      sub.user_id,
      leaseHolder
    );
    if (!leaseAfterCharge) {
      summary.errors.push({
        subscriptionId: sub.id,
        message: 'Lease lost after Wompi charge — left claimed for reconcile',
      });
      // Keep claim linked if we can still write tx id
      await casAttemptStatus(supabase, reference, ['claimed'], {
        wompi_transaction_id: tx.id,
        error_message: 'LEASE_LOST_AFTER_CHARGE',
      });
      return;
    }

    summary.charged++;

    // CAS claimed → pending only (never overwrite approved/declined)
    await casAttemptStatus(supabase, reference, ['claimed'], {
      status: 'pending',
      wompi_transaction_id: tx.id,
    });

    const settled = await wompi.waitForTransactionStatus(tx.id, {
      timeoutMs: 6000,
      intervalMs: 1000,
    });
    const status = settled.status.toUpperCase();

    if (status === 'APPROVED') {
      const leaseBeforeWrite = await refreshChargeLease(
        supabase,
        sub.user_id,
        leaseHolder
      );
      if (!leaseBeforeWrite) {
        summary.errors.push({
          subscriptionId: sub.id,
          message: 'Lease lost after APPROVED — left pending for reconcile',
        });
        return;
      }
      const ok = await applyApprovedRenewal(
        supabase,
        sub,
        livePeriodEnd,
        settled.amountInCents || amountInCents,
        reference,
        settled.id,
        plan.interval,
        plan.name,
        emailSender
      );
      if (ok) summary.approved++;
      return;
    }

    if (status === 'DECLINED' || status === 'ERROR' || status === 'VOIDED') {
      await applyWompiRenewalFailure(
        supabase,
        {
          reference,
          transactionId: settled.id,
          status:
            status === 'ERROR' || status === 'VOIDED' ? 'error' : 'declined',
          message: `Wompi status ${status}`,
        },
        emailSender
      );
      summary.failed++;
      const { data: refreshed } = await supabase
        .from('billing_subscriptions')
        .select('status')
        .eq('id', sub.id)
        .maybeSingle();
      if (refreshed?.status === 'canceled') {
        summary.downgraded++;
      }
      return;
    }

    await setPastDue(supabase, sub.id, livePeriodEnd);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Charge failed';

    if (isDefinitiveWompiChargeRejection(err)) {
      // 4xx validation — no transaction created; safe to finalize as error
      await markAttemptFailed(supabase, reference, 'error', null, message);
      await setPastDue(supabase, sub.id, livePeriodEnd);
      summary.failed++;
      summary.errors.push({ subscriptionId: sub.id, message });
      await sendBillingEmailOnce(supabase, emailSender, 'payment_failed', {
        userId: sub.user_id,
        subscriptionId: sub.id,
        email: user.email,
        locale: user.locale,
        periodKey: `${toPeriodEndYmd(livePeriodEnd)}:fail:${attemptNumber}`,
        planName: plan.name,
        amountLabel: formatCop(amountInCents),
      });
      if (attemptNumber >= MAX_DUNNING_ATTEMPTS) {
        await downgradeToFree(supabase, sub, plan.name, emailSender, livePeriodEnd);
        summary.downgraded++;
      }
      return;
    }

    // Network / 5xx / unknown — leave claimed; reconcile via reference lookup
    await casAttemptStatus(supabase, reference, ['claimed'], {
      error_message: message,
    });
    await setPastDue(supabase, sub.id, livePeriodEnd);
    summary.errors.push({
      subscriptionId: sub.id,
      message: `Charge inconclusive (kept claimed): ${message}`,
    });
  }
}

async function sendUpcomingRenewalEmails(
  supabase: SupabaseClient,
  now: Date,
  emailSender: BillingEmailSender,
  summary: RenewalRunSummary,
  deadlineMs = Date.now() + 60_000
): Promise<void> {
  const windowStart = new Date(now.getTime());
  const windowEnd = new Date(
    now.getTime() + UPCOMING_RENEWAL_DAYS * 24 * 60 * 60 * 1000
  );
  const batchSize = 50;
  let cursorPeriodEnd: string | null = null;
  let cursorId: string | null = null;

  while (Date.now() < deadlineMs) {
    let query = supabase
      .from('billing_subscriptions')
      .select(
        'id, user_id, plan_id, current_period_end, status, cancel_at_period_end, provider'
      )
      .eq('provider', 'wompi')
      .eq('status', 'active')
      .eq('cancel_at_period_end', false)
      .gt('current_period_end', windowStart.toISOString())
      .lte('current_period_end', windowEnd.toISOString())
      .order('current_period_end', { ascending: true })
      .order('id', { ascending: true })
      .limit(batchSize);

    if (cursorPeriodEnd && cursorId) {
      query = query.or(
        `current_period_end.gt.${cursorPeriodEnd},and(current_period_end.eq.${cursorPeriodEnd},id.gt.${cursorId})`
      );
    }

    const { data: upcoming, error } = await query;
    if (error) {
      summary.errors.push({
        subscriptionId: '-',
        message: `Upcoming emails query: ${error.message}`,
      });
      break;
    }
    if (!upcoming?.length) break;

    for (const sub of upcoming) {
      if (Date.now() >= deadlineMs) break;
      try {
        const plan = await getPlanMeta(supabase, sub.plan_id as string);
        const user = await getUserEmail(supabase, sub.user_id as string);
        if (!user || !plan || !sub.current_period_end) continue;

        const amountInCents = resolveWompiAmountInCents(
          sub.plan_id as string,
          plan.provider_price_map?.wompi
        );
        const periodKey = `${toPeriodEndYmd(sub.current_period_end as string)}:upcoming`;
        const result = await sendBillingEmailOnce(
          supabase,
          emailSender,
          'upcoming_renewal',
          {
            userId: sub.user_id as string,
            subscriptionId: sub.id as string,
            email: user.email,
            locale: user.locale,
            periodKey,
            planName: plan.name,
            amountLabel: formatCop(amountInCents),
            periodEndLabel: new Date(sub.current_period_end as string)
              .toISOString()
              .slice(0, 10),
          }
        );
        if (result.sent) summary.upcomingEmails++;
      } catch (err) {
        summary.errors.push({
          subscriptionId: sub.id as string,
          message: err instanceof Error ? err.message : 'Upcoming email failed',
        });
      }
    }

    const last = upcoming[upcoming.length - 1];
    cursorPeriodEnd = last.current_period_end as string;
    cursorId = last.id as string;
    if (upcoming.length < batchSize) break;
  }
}

/**
 * Process due Wompi renewals in batches until empty or time budget (~240s).
 */
export async function processWompiRenewals(
  supabase: SupabaseClient,
  wompi: WompiAdapter,
  options: ProcessRenewalsOptions = {}
): Promise<RenewalRunSummary> {
  const now = options.now ?? new Date();
  const batchSize = options.batchSize ?? 50;
  const timeBudgetMs = options.timeBudgetMs ?? 240_000;
  const deadline = Date.now() + timeBudgetMs;
  const emailSender = options.emailSender ?? getBillingEmailSender();

  const summary: RenewalRunSummary = {
    scanned: 0,
    charged: 0,
    reconciled: 0,
    approved: 0,
    failed: 0,
    downgraded: 0,
    canceledAtPeriodEnd: 0,
    upcomingEmails: 0,
    skipped: 0,
    batches: 0,
    errors: [],
  };

  // Heal approved first-charge attempts stuck on incomplete (crash between approve + promote)
  try {
    const { reconcileApprovedFirstCharges } = await import('./wompi-subscribe');
    const heal = await reconcileApprovedFirstCharges(supabase, {
      emailSender,
      deadlineMs: deadline,
      limit: batchSize,
    });
    summary.reconciled += heal.healed;
    if (heal.errors > 0) {
      summary.errors.push({
        subscriptionId: '-',
        message: `First-charge heal errors: ${heal.errors}`,
      });
    }
  } catch (err) {
    summary.errors.push({
      subscriptionId: '-',
      message:
        err instanceof Error
          ? `First-charge heal: ${err.message}`
          : 'First-charge heal failed',
    });
  }

  // Heal approved renewals with applied_at null (crash between approve + period extend)
  try {
    const renewHeal = await reconcileUnappliedApprovedRenewals(supabase, {
      emailSender,
      deadlineMs: deadline,
      limit: batchSize,
    });
    summary.reconciled += renewHeal.healed;
    summary.approved += renewHeal.healed;
    if (renewHeal.errors > 0) {
      summary.errors.push({
        subscriptionId: '-',
        message: `Renewal apply heal errors: ${renewHeal.errors}`,
      });
    }
  } catch (err) {
    summary.errors.push({
      subscriptionId: '-',
      message:
        err instanceof Error
          ? `Renewal apply heal: ${err.message}`
          : 'Renewal apply heal failed',
    });
  }

  let cursorPeriodEnd: string | null = null;
  let cursorId: string | null = null;

  while (Date.now() < deadline) {
    let query = supabase
      .from('billing_subscriptions')
      .select(
        'id, user_id, plan_id, status, cancel_at_period_end, current_period_end, current_period_start, billing_anchor_day, provider'
      )
      .eq('provider', 'wompi')
      .in('status', ['active', 'past_due'])
      .lte('current_period_end', now.toISOString())
      .order('current_period_end', { ascending: true })
      .order('id', { ascending: true })
      .limit(batchSize);

    // Keyset pagination
    if (cursorPeriodEnd && cursorId) {
      query = query.or(
        `current_period_end.gt.${cursorPeriodEnd},and(current_period_end.eq.${cursorPeriodEnd},id.gt.${cursorId})`
      );
    }

    const { data: dueSubs, error } = await query;

    if (error) {
      summary.errors.push({ subscriptionId: '-', message: error.message });
      break;
    }

    if (!dueSubs?.length) {
      break;
    }

    summary.batches++;
    summary.scanned += dueSubs.length;

    for (const sub of dueSubs) {
      if (Date.now() >= deadline) break;
      try {
        await processOneSubscription(
          supabase,
          wompi,
          sub as SubRow,
          now,
          summary,
          emailSender
        );
      } catch (err) {
        summary.errors.push({
          subscriptionId: sub.id as string,
          message: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    const last = dueSubs[dueSubs.length - 1];
    cursorPeriodEnd = last.current_period_end as string;
    cursorId = last.id as string;

    if (dueSubs.length < batchSize) {
      break;
    }
  }

  if (Date.now() < deadline) {
    try {
      await sendUpcomingRenewalEmails(
        supabase,
        now,
        emailSender,
        summary,
        deadline
      );
    } catch (err) {
      summary.errors.push({
        subscriptionId: '-',
        message:
          err instanceof Error
            ? `Upcoming emails: ${err.message}`
            : 'Upcoming emails failed',
      });
    }
  }

  return summary;
}

/**
 * Cron pass: approved renewals missing applied_at → heal under lease.
 */
export async function reconcileUnappliedApprovedRenewals(
  supabase: SupabaseClient,
  options: {
    limit?: number;
    emailSender?: BillingEmailSender;
    deadlineMs?: number;
  } = {}
): Promise<{ healed: number; refunded: number; errors: number }> {
  const limit = options.limit ?? 50;
  const deadlineMs = options.deadlineMs ?? Date.now() + 60_000;
  const emailSender = options.emailSender ?? getBillingEmailSender();
  const summary = { healed: 0, refunded: 0, errors: 0 };

  const { data: attempts, error } = await supabase
    .from('billing_renewal_attempts')
    .select(
      'wompi_reference, wompi_transaction_id, amount_cents, user_id, period_end'
    )
    .eq('status', 'approved')
    .is('applied_at', null)
    .or('requires_refund.is.null,requires_refund.eq.false')
    .neq('period_end', FIRST_CHARGE_PERIOD_SENTINEL)
    .order('claimed_at', { ascending: true })
    .limit(limit);

  if (error) {
    console.error(
      '[billing] reconcileUnappliedApprovedRenewals query failed',
      error
    );
    summary.errors++;
    return summary;
  }

  for (const attempt of attempts || []) {
    if (Date.now() >= deadlineMs) break;

    const leaseHolder = `heal-renew:${attempt.wompi_reference}`;
    const leased = await acquireChargeLease(
      supabase,
      attempt.user_id as string,
      leaseHolder
    );
    if (!leased) {
      summary.errors++;
      continue;
    }

    try {
      const heal = await healApprovedRenewalAttempt(supabase, {
        reference: attempt.wompi_reference as string,
        transactionId: (attempt.wompi_transaction_id as string) || undefined,
        amountCents: (attempt.amount_cents as number) || undefined,
        emailSender,
      });
      if (heal.healed) summary.healed++;
      else if (heal.refunded) summary.refunded++;
      else if (heal.retryable) summary.errors++;
    } catch (err) {
      console.error(
        '[billing] reconcileUnappliedApprovedRenewals heal failed',
        err instanceof Error ? err.message : err
      );
      summary.errors++;
    } finally {
      await releaseChargeLease(
        supabase,
        attempt.user_id as string,
        leaseHolder
      );
    }
  }

  return summary;
}

export async function chargeWompiPastDueNow(
  supabase: SupabaseClient,
  wompi: WompiAdapter,
  userId: string,
  emailSender: BillingEmailSender = getBillingEmailSender()
): Promise<{ charged: boolean; status?: string; message?: string }> {
  const { data: sub } = await supabase
    .from('billing_subscriptions')
    .select('*')
    .eq('user_id', userId)
    .eq('provider', 'wompi')
    .eq('status', 'past_due')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!sub?.current_period_end) {
    return { charged: false, message: 'No past_due subscription' };
  }

  const summary: RenewalRunSummary = {
    scanned: 1,
    charged: 0,
    reconciled: 0,
    approved: 0,
    failed: 0,
    downgraded: 0,
    canceledAtPeriodEnd: 0,
    upcomingEmails: 0,
    skipped: 0,
    batches: 1,
    errors: [],
  };

  await processOneSubscription(
    supabase,
    wompi,
    sub as SubRow,
    new Date(),
    summary,
    emailSender
  );

  if (summary.approved > 0) return { charged: true, status: 'approved' };
  if (summary.charged > 0) return { charged: true, status: 'pending' };
  return {
    charged: false,
    status: 'failed',
    message: summary.errors[0]?.message,
  };
}
