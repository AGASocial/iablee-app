/**
 * Wompi nightly renewals + dunning (KAN-166).
 *
 * Idempotency: insert renewal attempt with unique (subscription_id, period_end,
 * attempt_number) BEFORE calling Wompi. Concurrent cron runs cannot double-charge.
 * Pending attempts are reconciled via GET /transactions/{id} instead of new charges.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { WompiAdapter } from './adapters/wompi.adapter';
import { resolveWompiAmountInCents } from './wompi-pricing';
import {
  buildWompiRenewalReference,
  toPeriodEndYmd,
} from './wompi-references';
import {
  extendPeriodEnd,
  getDueDunningAttempt,
  isPastFinalDunningDay,
  MAX_DUNNING_ATTEMPTS,
  UPCOMING_RENEWAL_DAYS,
} from './dunning';
import {
  getBillingEmailSender,
  sendBillingEmailOnce,
  type BillingEmailSender,
} from './billing-emails';

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
  errors: Array<{ subscriptionId: string; message: string }>;
}

export interface ProcessRenewalsOptions {
  now?: Date;
  batchSize?: number;
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
  provider: string;
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
  return {
    email: data.email as string,
    locale: null,
  };
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
  brand: string | null;
  last4: string | null;
} | null> {
  const { data } = await supabase
    .from('billing_payment_methods')
    .select(
      'id, provider_payment_source_id, method_type, brand, last4'
    )
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
    brand: string | null;
    last4: string | null;
  };
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
): Promise<void> {
  const previousEnd = new Date(periodEnd);
  const newEnd = extendPeriodEnd(previousEnd, planInterval);
  const nowIso = new Date().toISOString();

  await supabase
    .from('billing_subscriptions')
    .update({
      status: 'active',
      current_period_start: previousEnd.toISOString(),
      current_period_end: newEnd.toISOString(),
      cancel_at_period_end: false,
      updated_at: nowIso,
    })
    .eq('id', sub.id);

  await supabase.from('billing_invoices').upsert(
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
  ).then(async result => {
    // Fallback if unique index not applied yet
    if (result.error) {
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
  });

  await supabase
    .from('billing_renewal_attempts')
    .update({
      status: 'approved',
      wompi_transaction_id: transactionId,
      finalized_at: nowIso,
      updated_at: nowIso,
    })
    .eq('wompi_reference', reference);

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
}

async function markAttemptFailed(
  supabase: SupabaseClient,
  reference: string,
  status: 'declined' | 'error',
  transactionId: string | null,
  message?: string
): Promise<void> {
  const nowIso = new Date().toISOString();
  await supabase
    .from('billing_renewal_attempts')
    .update({
      status,
      wompi_transaction_id: transactionId,
      error_message: message || null,
      finalized_at: nowIso,
      updated_at: nowIso,
    })
    .eq('wompi_reference', reference);
}

async function setPastDue(supabase: SupabaseClient, subscriptionId: string): Promise<void> {
  await supabase
    .from('billing_subscriptions')
    .update({
      status: 'past_due',
      updated_at: new Date().toISOString(),
    })
    .eq('id', subscriptionId);
}

async function downgradeToFree(
  supabase: SupabaseClient,
  sub: SubRow,
  planName: string,
  emailSender: BillingEmailSender,
  periodEnd: string
): Promise<void> {
  const nowIso = new Date().toISOString();
  await supabase
    .from('billing_subscriptions')
    .update({
      status: 'canceled',
      canceled_at: nowIso,
      cancel_at_period_end: false,
      updated_at: nowIso,
    })
    .eq('id', sub.id);

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

/**
 * Apply APPROVED renewal from webhook (idempotent).
 */
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

  if (!attempt) {
    return false;
  }

  if (attempt.status === 'approved') {
    return true;
  }

  const { data: sub } = await supabase
    .from('billing_subscriptions')
    .select('*')
    .eq('id', attempt.subscription_id)
    .maybeSingle();

  if (!sub) return false;

  const plan = await getPlanMeta(supabase, sub.plan_id as string);
  await applyApprovedRenewal(
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
  return true;
}

/**
 * Apply DECLINED/ERROR renewal from webhook.
 */
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
  if (attempt.status === 'approved') return true;

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

  await setPastDue(supabase, sub.id as string);

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

  if (
    (attempt.attempt_number as number) >= MAX_DUNNING_ATTEMPTS ||
    isPastFinalDunningDay(attempt.period_end as string)
  ) {
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
  attempt: {
    id: string;
    subscription_id: string;
    user_id: string;
    period_end: string;
    attempt_number: number;
    wompi_reference: string;
    wompi_transaction_id: string | null;
    amount_cents: number | null;
  },
  sub: SubRow,
  planName: string,
  planInterval: 'month' | 'year',
  emailSender: BillingEmailSender
): Promise<'approved' | 'pending' | 'failed'> {
  if (!attempt.wompi_transaction_id) {
    return 'pending';
  }

  const tx = await wompi.getTransaction(attempt.wompi_transaction_id);
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
    await applyWompiRenewalFailure(supabase, {
      reference: attempt.wompi_reference,
      transactionId: tx.id,
      status: status === 'ERROR' ? 'error' : 'declined',
      message: `Wompi status ${status}`,
    }, emailSender);
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
  const periodEndDate = new Date(periodEnd);

  // Enforce cancel_at_period_end: end with no charge
  if (sub.cancel_at_period_end && periodEndDate.getTime() <= now.getTime()) {
    const nowIso = now.toISOString();
    await supabase
      .from('billing_subscriptions')
      .update({
        status: 'canceled',
        canceled_at: nowIso,
        updated_at: nowIso,
      })
      .eq('id', sub.id)
      .neq('status', 'canceled');
    summary.canceledAtPeriodEnd++;
    return;
  }

  if (sub.cancel_at_period_end) {
    summary.skipped++;
    return;
  }

  const dueAttempt = getDueDunningAttempt(periodEnd, now);
  if (dueAttempt == null) {
    summary.skipped++;
    return;
  }

  // Existing pending attempt for this period → reconcile, never new charge
  const { data: pendingAttempts } = await supabase
    .from('billing_renewal_attempts')
    .select('*')
    .eq('subscription_id', sub.id)
    .eq('period_end', periodEnd)
    .in('status', ['claimed', 'pending']);

  const plan = await getPlanMeta(supabase, sub.plan_id);
  if (!plan) {
    summary.errors.push({
      subscriptionId: sub.id,
      message: 'Plan not found',
    });
    return;
  }

  if (pendingAttempts && pendingAttempts.length > 0) {
    for (const attempt of pendingAttempts) {
      const result = await reconcilePendingAttempt(
        supabase,
        wompi,
        attempt as {
          id: string;
          subscription_id: string;
          user_id: string;
          period_end: string;
          attempt_number: number;
          wompi_reference: string;
          wompi_transaction_id: string | null;
          amount_cents: number | null;
        },
        sub,
        plan.name,
        plan.interval,
        emailSender
      );
      summary.reconciled++;
      if (result === 'approved') summary.approved++;
      if (result === 'failed') summary.failed++;
    }
    return;
  }

  // Already approved for this period?
  const { data: approved } = await supabase
    .from('billing_renewal_attempts')
    .select('id')
    .eq('subscription_id', sub.id)
    .eq('period_end', periodEnd)
    .eq('status', 'approved')
    .maybeSingle();

  if (approved) {
    summary.skipped++;
    return;
  }

  // Past final dunning with no approval → downgrade
  if (isPastFinalDunningDay(periodEnd, now) && dueAttempt >= MAX_DUNNING_ATTEMPTS) {
    const { data: anyApproved } = await supabase
      .from('billing_renewal_attempts')
      .select('id')
      .eq('subscription_id', sub.id)
      .eq('period_end', periodEnd)
      .eq('status', 'approved')
      .maybeSingle();

    if (!anyApproved) {
      await downgradeToFree(supabase, sub, plan.name, emailSender, periodEnd);
      summary.downgraded++;
      return;
    }
  }

  // Highest finalized attempt so far
  const { data: priorAttempts } = await supabase
    .from('billing_renewal_attempts')
    .select('attempt_number, status')
    .eq('subscription_id', sub.id)
    .eq('period_end', periodEnd)
    .order('attempt_number', { ascending: false });

  const highestDone = priorAttempts?.[0]?.attempt_number ?? 0;
  if (dueAttempt <= highestDone) {
    // Slot already used; if past final and never approved, downgrade handled above
    if (
      isPastFinalDunningDay(periodEnd, now) &&
      !priorAttempts?.some(a => a.status === 'approved')
    ) {
      await downgradeToFree(supabase, sub, plan.name, emailSender, periodEnd);
      summary.downgraded++;
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
  const reference = buildWompiRenewalReference(sub.id, periodEnd, attemptNumber);

  // Claim BEFORE calling Wompi
  const { error: claimError } = await supabase.from('billing_renewal_attempts').insert({
    subscription_id: sub.id,
    user_id: sub.user_id,
    period_end: periodEnd,
    attempt_number: attemptNumber,
    status: 'claimed',
    wompi_reference: reference,
    amount_cents: amountInCents,
    currency: 'COP',
  });

  if (claimError) {
    // Another worker claimed this slot
    summary.skipped++;
    return;
  }

  const pm = await getDefaultPaymentSource(supabase, sub.user_id);
  if (!pm) {
    await markAttemptFailed(supabase, reference, 'error', null, 'No payment method');
    await setPastDue(supabase, sub.id);
    summary.failed++;

    if (attemptNumber >= MAX_DUNNING_ATTEMPTS || isPastFinalDunningDay(periodEnd, now)) {
      await downgradeToFree(supabase, sub, plan.name, emailSender, periodEnd);
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

    summary.charged++;

    await supabase
      .from('billing_renewal_attempts')
      .update({
        status: 'pending',
        wompi_transaction_id: tx.id,
        updated_at: new Date().toISOString(),
      })
      .eq('wompi_reference', reference);

    // Short poll
    const settled = await wompi.waitForTransactionStatus(tx.id, {
      timeoutMs: 6000,
      intervalMs: 1000,
    });
    const status = settled.status.toUpperCase();

    if (status === 'APPROVED') {
      await applyApprovedRenewal(
        supabase,
        sub,
        periodEnd,
        settled.amountInCents || amountInCents,
        reference,
        settled.id,
        plan.interval,
        plan.name,
        emailSender
      );
      summary.approved++;
      return;
    }

    if (status === 'DECLINED' || status === 'ERROR' || status === 'VOIDED') {
      await applyWompiRenewalFailure(
        supabase,
        {
          reference,
          transactionId: settled.id,
          status: status === 'ERROR' ? 'error' : 'declined',
          message: `Wompi status ${status}`,
        },
        emailSender
      );
      summary.failed++;
      if (
        attemptNumber >= MAX_DUNNING_ATTEMPTS ||
        isPastFinalDunningDay(periodEnd, now)
      ) {
        // Failure helper may already downgrade; count if canceled
        const { data: refreshed } = await supabase
          .from('billing_subscriptions')
          .select('status')
          .eq('id', sub.id)
          .maybeSingle();
        if (refreshed?.status === 'canceled') {
          summary.downgraded++;
        }
      }
      return;
    }

    // Still PENDING — leave for next cron / webhook
    await setPastDue(supabase, sub.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Charge failed';
    await markAttemptFailed(supabase, reference, 'error', null, message);
    await setPastDue(supabase, sub.id);
    summary.failed++;
    summary.errors.push({ subscriptionId: sub.id, message });

    const userForEmail = user;
    await sendBillingEmailOnce(supabase, emailSender, 'payment_failed', {
      userId: sub.user_id,
      subscriptionId: sub.id,
      email: userForEmail.email,
      locale: userForEmail.locale,
      periodKey: `${toPeriodEndYmd(periodEnd)}:fail:${attemptNumber}`,
      planName: plan.name,
      amountLabel: formatCop(amountInCents),
    });
  }
}

async function sendUpcomingRenewalEmails(
  supabase: SupabaseClient,
  now: Date,
  emailSender: BillingEmailSender,
  summary: RenewalRunSummary
): Promise<void> {
  const windowStart = new Date(now.getTime());
  const windowEnd = new Date(
    now.getTime() + UPCOMING_RENEWAL_DAYS * 24 * 60 * 60 * 1000
  );

  const { data: upcoming } = await supabase
    .from('billing_subscriptions')
    .select('id, user_id, plan_id, current_period_end, status, cancel_at_period_end, provider')
    .eq('provider', 'wompi')
    .eq('status', 'active')
    .eq('cancel_at_period_end', false)
    .gt('current_period_end', windowStart.toISOString())
    .lte('current_period_end', windowEnd.toISOString())
    .limit(100);

  for (const sub of upcoming || []) {
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
          periodEndLabel: new Date(sub.current_period_end as string).toISOString().slice(0, 10),
        }
      );
      if (result.sent) summary.upcomingEmails++;
    } catch (err) {
      summary.errors.push({
        subscriptionId: sub.id as string,
        message:
          err instanceof Error ? err.message : 'Upcoming email failed',
      });
    }
  }
}

/**
 * Main cron entry: process due Wompi renewals in a bounded batch.
 */
export async function processWompiRenewals(
  supabase: SupabaseClient,
  wompi: WompiAdapter,
  options: ProcessRenewalsOptions = {}
): Promise<RenewalRunSummary> {
  const now = options.now ?? new Date();
  const batchSize = options.batchSize ?? 50;
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
    errors: [],
  };

  const { data: dueSubs, error } = await supabase
    .from('billing_subscriptions')
    .select(
      'id, user_id, plan_id, status, cancel_at_period_end, current_period_end, current_period_start, provider'
    )
    .eq('provider', 'wompi')
    .in('status', ['active', 'past_due'])
    .lte('current_period_end', now.toISOString())
    .order('current_period_end', { ascending: true })
    .limit(batchSize);

  if (error) {
    summary.errors.push({
      subscriptionId: '-',
      message: error.message,
    });
    return summary;
  }

  summary.scanned = dueSubs?.length || 0;

  for (const sub of dueSubs || []) {
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

  try {
    await sendUpcomingRenewalEmails(supabase, now, emailSender, summary);
  } catch (err) {
    summary.errors.push({
      subscriptionId: '-',
      message:
        err instanceof Error
          ? `Upcoming emails: ${err.message}`
          : 'Upcoming emails failed',
    });
  }

  return summary;
}

/**
 * Immediately attempt a past_due charge after payment method replacement.
 */
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

  if (summary.approved > 0) {
    return { charged: true, status: 'approved' };
  }
  if (summary.charged > 0) {
    return { charged: true, status: 'pending' };
  }
  return {
    charged: false,
    status: 'failed',
    message: summary.errors[0]?.message,
  };
}
