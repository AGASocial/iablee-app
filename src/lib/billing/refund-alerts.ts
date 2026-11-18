/**
 * Ops alerts for billing_renewal_attempts.requires_refund (KAN-167).
 *
 * - Per-attempt: CAS claim on refund_alerted_at → send → clear on failure.
 * - BILLING_ALERT_EMAIL unset: log CRITICAL (ids only), leave refund_alerted_at
 *   NULL so configuring the env later still alerts; nightly batches one CRITICAL
 *   line with count to avoid per-attempt log spam.
 * - Daily summary: billing_email_events email_type=refund_summary,
 *   period_key=refund_summary_YYYYMMDD (UTC). Failures never throw into billing.
 */

import { Resend } from 'resend';
import type { SupabaseClient } from '@supabase/supabase-js';

const FROM_EMAIL =
  process.env.RESEND_FROM_EMAIL ?? 'Iablee <notifications@security.iablee.com>';

export type RefundAlertAttempt = {
  id: string;
  user_id: string;
  subscription_id: string;
  wompi_reference: string;
  wompi_transaction_id: string | null;
  amount_cents: number | null;
  currency: string | null;
  refund_reason: string | null;
  requires_refund?: boolean | null;
  refund_alerted_at?: string | null;
  refund_resolved_at?: string | null;
};

export function parseBillingAlertEmails(
  raw: string | undefined | null = process.env.BILLING_ALERT_EMAIL
): string[] {
  if (!raw || !raw.trim()) return [];
  return raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

export function refundSummaryPeriodKey(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `refund_summary_${y}${m}${d}`;
}

function formatAmount(cents: number | null, currency: string | null): string {
  if (cents == null) return 'unknown';
  const cur = (currency || 'COP').toUpperCase();
  if (cur === 'COP') {
    return `${Math.round(cents / 100)} COP`;
  }
  return `${cents} ${cur} (cents)`;
}

function buildAttemptAlertHtml(attempt: RefundAlertAttempt): string {
  const tx = attempt.wompi_transaction_id || '(none)';
  return `<p><strong>Wompi requires_refund</strong> — manual refund needed.</p>
<ul>
<li>attempt id: ${attempt.id}</li>
<li>subscription id: ${attempt.subscription_id}</li>
<li>user id: ${attempt.user_id}</li>
<li>Wompi reference: ${attempt.wompi_reference}</li>
<li>Wompi transaction id: ${tx}</li>
<li>amount: ${formatAmount(attempt.amount_cents, attempt.currency)}</li>
<li>refund_reason: ${attempt.refund_reason || '(none)'}</li>
</ul>
<p>Refund in the Wompi dashboard, then mark resolved (see docs/BILLING-SETUP.md).</p>`;
}

async function sendAdminEmail(
  to: string[],
  subject: string,
  html: string
): Promise<{ sent: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error(
      '[billing] CRITICAL: RESEND_API_KEY unset; cannot send refund alert'
    );
    return { sent: false, error: 'RESEND_API_KEY unset' };
  }
  try {
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject,
      html,
    });
    if (error) {
      console.error('[billing] Refund alert send failed:', error);
      return { sent: false, error: 'Failed to send refund alert' };
    }
    return { sent: true };
  } catch (err) {
    console.error('[billing] Refund alert exception:', err);
    return {
      sent: false,
      error: err instanceof Error ? err.message : 'Refund alert failed',
    };
  }
}

/**
 * Load attempt by reference or id (ids only — no PII).
 */
export async function loadRefundAlertAttempt(
  supabase: SupabaseClient,
  key: { reference?: string; id?: string }
): Promise<RefundAlertAttempt | null> {
  let q = supabase
    .from('billing_renewal_attempts')
    .select(
      'id, user_id, subscription_id, wompi_reference, wompi_transaction_id, amount_cents, currency, refund_reason, requires_refund, refund_alerted_at, refund_resolved_at'
    );
  if (key.id) q = q.eq('id', key.id);
  else if (key.reference) q = q.eq('wompi_reference', key.reference);
  else return null;

  const { data, error } = await q.maybeSingle();
  if (error) {
    console.error('[billing] loadRefundAlertAttempt failed', {
      message: error.message,
      reference: key.reference,
      id: key.id,
    });
    return null;
  }
  return (data as RefundAlertAttempt) || null;
}

/**
 * Claim refund_alerted_at (CAS), send admin email, clear claim on failure.
 * Never throws.
 */
export async function alertRequiresRefundOnce(
  supabase: SupabaseClient,
  attempt: RefundAlertAttempt
): Promise<{ sent: boolean; skipped?: boolean; error?: string }> {
  try {
    if (attempt.requires_refund !== true && attempt.requires_refund !== undefined) {
      return { sent: false, skipped: true };
    }
    if (attempt.refund_alerted_at) {
      return { sent: false, skipped: true };
    }

    const recipients = parseBillingAlertEmails();
    if (recipients.length === 0) {
      // Leave refund_alerted_at NULL so configuring BILLING_ALERT_EMAIL later still alerts.
      console.error(
        '[billing] CRITICAL: BILLING_ALERT_EMAIL unset; requires_refund not alerted',
        {
          attemptId: attempt.id,
          subscriptionId: attempt.subscription_id,
          userId: attempt.user_id,
          reference: attempt.wompi_reference,
        }
      );
      return { sent: false, error: 'BILLING_ALERT_EMAIL unset' };
    }

    const nowIso = new Date().toISOString();
    const { data: claimed, error: claimError } = await supabase
      .from('billing_renewal_attempts')
      .update({ refund_alerted_at: nowIso, updated_at: nowIso })
      .eq('id', attempt.id)
      .eq('requires_refund', true)
      .is('refund_alerted_at', null)
      .select('id')
      .maybeSingle();

    if (claimError) {
      console.error('[billing] refund_alerted_at CAS failed', {
        attemptId: attempt.id,
        message: claimError.message,
      });
      return { sent: false, error: claimError.message };
    }
    if (!claimed?.id) {
      return { sent: false, skipped: true };
    }

    const result = await sendAdminEmail(
      recipients,
      `[billing] requires_refund ${attempt.wompi_reference}`,
      buildAttemptAlertHtml(attempt)
    );

    if (!result.sent) {
      await supabase
        .from('billing_renewal_attempts')
        .update({ refund_alerted_at: null, updated_at: new Date().toISOString() })
        .eq('id', attempt.id)
        .eq('refund_alerted_at', nowIso);
      return result;
    }

    return { sent: true };
  } catch (err) {
    console.error('[billing] alertRequiresRefundOnce threw', err);
    return {
      sent: false,
      error: err instanceof Error ? err.message : 'alert failed',
    };
  }
}

/** Convenience: load by reference/id then alert. Never throws. */
export async function notifyRequiresRefundAlert(
  supabase: SupabaseClient,
  key: { reference?: string; id?: string }
): Promise<{ sent: boolean; skipped?: boolean; error?: string }> {
  try {
    const attempt = await loadRefundAlertAttempt(supabase, key);
    if (!attempt || attempt.requires_refund !== true) {
      return { sent: false, skipped: true };
    }
    return await alertRequiresRefundOnce(supabase, attempt);
  } catch (err) {
    console.error('[billing] notifyRequiresRefundAlert threw', err);
    return {
      sent: false,
      error: err instanceof Error ? err.message : 'notify failed',
    };
  }
}

export type RefundAlertSweepSummary = {
  unalertedRetried: number;
  alertsSent: number;
  unresolvedCount: number;
  unresolvedIds: string[];
  summaryEmailSent: boolean;
};

/**
 * Nightly: retry unalerted requires_refund rows + send one daily unresolved summary.
 * Never throws.
 */
export async function processRequiresRefundAlerts(
  supabase: SupabaseClient,
  options: { now?: Date; limit?: number } = {}
): Promise<RefundAlertSweepSummary> {
  const now = options.now ?? new Date();
  const limit = options.limit ?? 100;
  const out: RefundAlertSweepSummary = {
    unalertedRetried: 0,
    alertsSent: 0,
    unresolvedCount: 0,
    unresolvedIds: [],
    summaryEmailSent: false,
  };

  try {
    const { data: unalerted, error: unalertedError } = await supabase
      .from('billing_renewal_attempts')
      .select(
        'id, user_id, subscription_id, wompi_reference, wompi_transaction_id, amount_cents, currency, refund_reason, requires_refund, refund_alerted_at, refund_resolved_at'
      )
      .eq('requires_refund', true)
      .is('refund_alerted_at', null)
      .order('claimed_at', { ascending: true })
      .limit(limit);

    if (unalertedError) {
      console.error(
        '[billing] unalerted requires_refund query failed',
        unalertedError.message
      );
    } else {
      const recipients = parseBillingAlertEmails();
      if (recipients.length === 0 && (unalerted?.length || 0) > 0) {
        console.error(
          '[billing] CRITICAL: BILLING_ALERT_EMAIL unset; unalerted requires_refund pending',
          {
            count: unalerted!.length,
            attemptIds: unalerted!.map(a => a.id),
          }
        );
      } else {
        for (const row of unalerted || []) {
          out.unalertedRetried++;
          const result = await alertRequiresRefundOnce(
            supabase,
            row as RefundAlertAttempt
          );
          if (result.sent) out.alertsSent++;
        }
      }
    }

    const { data: unresolved, error: unresolvedError } = await supabase
      .from('billing_renewal_attempts')
      .select('id, user_id')
      .eq('requires_refund', true)
      .is('refund_resolved_at', null)
      .order('claimed_at', { ascending: true })
      .limit(limit);

    if (unresolvedError) {
      console.error(
        '[billing] unresolved requires_refund query failed',
        unresolvedError.message
      );
      return out;
    }

    out.unresolvedCount = unresolved?.length || 0;
    out.unresolvedIds = (unresolved || []).map(r => r.id as string);

    if (out.unresolvedCount === 0) {
      return out;
    }

    const recipients = parseBillingAlertEmails();
    if (recipients.length === 0) {
      console.error(
        '[billing] CRITICAL: BILLING_ALERT_EMAIL unset; skipping refund_summary',
        { count: out.unresolvedCount, attemptIds: out.unresolvedIds }
      );
      return out;
    }

    const periodKey = refundSummaryPeriodKey(now);
    const claimUserId = (unresolved![0].user_id as string) || out.unresolvedIds[0];

    const { data: claimed, error: insertError } = await supabase
      .from('billing_email_events')
      .insert({
        user_id: claimUserId,
        subscription_id: null,
        email_type: 'refund_summary',
        period_key: periodKey,
        provider: 'wompi',
        metadata: {
          count: out.unresolvedCount,
          attemptIds: out.unresolvedIds,
        },
      })
      .select('id')
      .maybeSingle();

    if (insertError) {
      if (
        insertError.code === '23505' ||
        /duplicate|unique/i.test(insertError.message || '')
      ) {
        return out;
      }
      console.error(
        '[billing] refund_summary claim failed',
        insertError.message
      );
      // Fall through and still try send once without durable claim
    }

    const html = `<p><strong>Daily unresolved Wompi requires_refund</strong></p>
<p>Count: ${out.unresolvedCount}</p>
<p>Attempt ids:</p>
<ul>${out.unresolvedIds.map(id => `<li>${id}</li>`).join('')}</ul>
<p>Refund in Wompi dashboard, then mark resolved (docs/BILLING-SETUP.md).</p>`;

    const sent = await sendAdminEmail(
      recipients,
      `[billing] unresolved requires_refund (${out.unresolvedCount}) ${periodKey}`,
      html
    );

    if (!sent.sent && claimed?.id) {
      await supabase.from('billing_email_events').delete().eq('id', claimed.id);
    }
    out.summaryEmailSent = !!sent.sent;
  } catch (err) {
    console.error('[billing] processRequiresRefundAlerts threw', err);
  }

  return out;
}
