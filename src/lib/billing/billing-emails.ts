/**
 * Billing notification emails via Resend (KAN-166).
 * Failures never throw into billing logic — callers treat send as best-effort.
 */

import { Resend } from 'resend';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getAuthRedirectOrigin } from '@/lib/app-url';

type EmailLocale = 'en' | 'es';

function resolveEmailLocale(locale?: string | null): EmailLocale {
  return locale === 'es' ? 'es' : 'en';
}

export type BillingEmailType =
  | 'renewal_success'
  | 'payment_failed'
  | 'upcoming_renewal'
  | 'downgrade_to_free';

export interface BillingEmailPayload {
  userId: string;
  subscriptionId?: string | null;
  email: string;
  locale?: string | null;
  periodKey: string;
  planName?: string;
  amountLabel?: string;
  nextRetryLabel?: string;
  periodEndLabel?: string;
}

export interface BillingEmailSender {
  send(type: BillingEmailType, payload: BillingEmailPayload): Promise<{ sent: boolean; error?: string }>;
}

const FROM_EMAIL =
  process.env.RESEND_FROM_EMAIL ?? 'Iablee <notifications@security.iablee.com>';

function billingUrl(locale: EmailLocale): string {
  const origin = getAuthRedirectOrigin();
  return `${origin}/${locale}/billing`;
}

function copyFor(
  type: BillingEmailType,
  locale: EmailLocale,
  payload: BillingEmailPayload
): { subject: string; html: string } {
  const url = billingUrl(locale);
  const plan = payload.planName || (locale === 'es' ? 'Premium' : 'Premium');
  const amount = payload.amountLabel || '';

  if (locale === 'es') {
    switch (type) {
      case 'renewal_success':
        return {
          subject: `Renovación exitosa — ${plan}`,
          html: `<p>Hola,</p><p>Tu suscripción <strong>${plan}</strong> se renovó correctamente${amount ? ` por ${amount}` : ''}.</p><p><a href="${url}">Ver facturación</a></p>`,
        };
      case 'payment_failed':
        return {
          subject: `Pago fallido — ${plan}`,
          html: `<p>Hola,</p><p>No pudimos cobrar tu suscripción <strong>${plan}</strong>${amount ? ` (${amount})` : ''}.</p>${payload.nextRetryLabel ? `<p>Próximo intento: ${payload.nextRetryLabel}.</p>` : ''}<p>Actualiza tu método de pago aquí: <a href="${url}">${url}</a></p>`,
        };
      case 'upcoming_renewal':
        return {
          subject: `Próxima renovación — ${plan}`,
          html: `<p>Hola,</p><p>Tu plan <strong>${plan}</strong> se renovará el ${payload.periodEndLabel || 'próximamente'}${amount ? ` por ${amount}` : ''}.</p><p><a href="${url}">Administrar facturación</a></p>`,
        };
      case 'downgrade_to_free':
        return {
          subject: 'Tu cuenta pasó al plan Free',
          html: `<p>Hola,</p><p>Tras varios intentos de cobro fallidos, tu cuenta pasó al plan Free. El contenido existente se conserva; para seguir agregando activos Premium, actualiza tu pago.</p><p><a href="${url}">Actualizar método de pago</a></p>`,
        };
    }
  }

  switch (type) {
    case 'renewal_success':
      return {
        subject: `Renewal successful — ${plan}`,
        html: `<p>Hi,</p><p>Your <strong>${plan}</strong> subscription renewed successfully${amount ? ` for ${amount}` : ''}.</p><p><a href="${url}">View billing</a></p>`,
      };
    case 'payment_failed':
      return {
        subject: `Payment failed — ${plan}`,
        html: `<p>Hi,</p><p>We could not charge your <strong>${plan}</strong> subscription${amount ? ` (${amount})` : ''}.</p>${payload.nextRetryLabel ? `<p>Next retry: ${payload.nextRetryLabel}.</p>` : ''}<p>Update your payment method: <a href="${url}">${url}</a></p>`,
      };
    case 'upcoming_renewal':
      return {
        subject: `Upcoming renewal — ${plan}`,
        html: `<p>Hi,</p><p>Your <strong>${plan}</strong> plan renews on ${payload.periodEndLabel || 'soon'}${amount ? ` for ${amount}` : ''}.</p><p><a href="${url}">Manage billing</a></p>`,
      };
    case 'downgrade_to_free':
      return {
        subject: 'Your account moved to the Free plan',
        html: `<p>Hi,</p><p>After several failed payment attempts, your account moved to Free. Existing content is kept; update payment to keep adding Premium assets.</p><p><a href="${url}">Update payment method</a></p>`,
      };
  }
}

export class ResendBillingEmailSender implements BillingEmailSender {
  private resend: Resend | null;

  constructor(apiKey = process.env.RESEND_API_KEY) {
    this.resend = apiKey ? new Resend(apiKey) : null;
  }

  async send(
    type: BillingEmailType,
    payload: BillingEmailPayload
  ): Promise<{ sent: boolean; error?: string }> {
    if (!this.resend) {
      console.error('RESEND_API_KEY is not configured; skipping billing email');
      return { sent: false, error: 'Email service not configured' };
    }

    const locale = resolveEmailLocale(payload.locale);
    const { subject, html } = copyFor(type, locale, payload);

    try {
      const { error } = await this.resend.emails.send({
        from: FROM_EMAIL,
        to: [payload.email],
        subject,
        html,
      });
      if (error) {
        console.error('Billing email send failed:', error);
        return { sent: false, error: 'Failed to send billing email' };
      }
      return { sent: true };
    } catch (err) {
      console.error('Billing email exception:', err);
      return {
        sent: false,
        error: err instanceof Error ? err.message : 'Failed to send billing email',
      };
    }
  }
}

/**
 * Claim idempotency row then send. Never throws; returns whether email was sent.
 */
export async function sendBillingEmailOnce(
  supabase: SupabaseClient,
  sender: BillingEmailSender,
  type: BillingEmailType,
  payload: BillingEmailPayload,
  provider: string | null = 'wompi'
): Promise<{ sent: boolean; skipped?: boolean; error?: string }> {
  const { error: insertError } = await supabase.from('billing_email_events').insert({
    user_id: payload.userId,
    subscription_id: payload.subscriptionId || null,
    email_type: type,
    period_key: payload.periodKey,
    provider,
    metadata: {
      planName: payload.planName,
      amountLabel: payload.amountLabel,
    },
  });

  if (insertError) {
    // Unique violation → already sent
    if (
      insertError.code === '23505' ||
      /duplicate|unique/i.test(insertError.message || '')
    ) {
      return { sent: false, skipped: true };
    }
    console.error('Failed to claim billing email event:', insertError.message);
    // Still try to send — better duplicate than silent miss
  }

  try {
    return await sender.send(type, payload);
  } catch (err) {
    console.error('Billing email sender threw:', err);
    return {
      sent: false,
      error: err instanceof Error ? err.message : 'Email sender failed',
    };
  }
}

let defaultSender: BillingEmailSender | null = null;

export function getBillingEmailSender(): BillingEmailSender {
  if (!defaultSender) {
    defaultSender = new ResendBillingEmailSender();
  }
  return defaultSender;
}

/** Test helper */
export function setBillingEmailSender(sender: BillingEmailSender | null): void {
  defaultSender = sender;
}
