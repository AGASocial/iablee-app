import { createHash, randomBytes } from 'crypto';
import { Resend } from 'resend';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAppUrl } from '@/lib/app-url';
import {
  getBeneficiaryVerificationCopy,
  getBeneficiaryVerificationTemplateId,
  resolveEmailLocale,
  type EmailLocale,
} from '@/lib/beneficiary-email-copy';

const resend = new Resend(process.env.RESEND_API_KEY);

const TOKEN_BYTES = 32;
const TOKEN_TTL_HOURS = 48;

const FROM_EMAIL =
  process.env.RESEND_FROM_EMAIL ?? 'Iablee <notifications@security.iablee.com>';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function buildVerificationUrl(token: string, locale: EmailLocale): string {
  const appUrl = getAppUrl();
  const params = new URLSearchParams({
    token,
    locale,
  });
  return `${appUrl}/api/beneficiaries/verify-email?${params.toString()}`;
}

export async function sendBeneficiaryVerificationEmail(params: {
  beneficiaryId: string;
  beneficiaryName: string;
  email: string;
  ownerName?: string | null;
  locale?: string | null;
}): Promise<{ sent: boolean; error?: string }> {
  if (!process.env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY is not configured');
    return { sent: false, error: 'Email service not configured' };
  }

  const locale = resolveEmailLocale(params.locale);
  const copy = getBeneficiaryVerificationCopy(locale);
  const templateId = getBeneficiaryVerificationTemplateId(locale);

  const token = randomBytes(TOKEN_BYTES).toString('hex');
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_HOURS * 60 * 60 * 1000).toISOString();

  await supabaseAdmin
    .from('beneficiary_email_verifications')
    .update({ used_at: new Date().toISOString() })
    .eq('beneficiary_id', params.beneficiaryId)
    .is('used_at', null);

  const { error: insertError } = await supabaseAdmin
    .from('beneficiary_email_verifications')
    .insert({
      beneficiary_id: params.beneficiaryId,
      token_hash: tokenHash,
      expires_at: expiresAt,
    });

  if (insertError) {
    console.error('Error storing beneficiary verification token:', insertError);
    return { sent: false, error: 'Failed to create verification token' };
  }

  const verificationUrl = buildVerificationUrl(token, locale);
  const ownerName = params.ownerName ?? copy.ownerFallback;

  const templateVariables = {
    BENEFICIARY_NAME: params.beneficiaryName,
    OWNER_NAME: ownerName,
    VERIFICATION_URL: verificationUrl,
    EXPIRY_HOURS: String(TOKEN_TTL_HOURS),
  };

  const { error: emailError } = templateId
    ? await resend.emails.send({
        from: FROM_EMAIL,
        to: [params.email],
        subject: copy.subject(ownerName),
        template: {
          id: templateId,
          variables: templateVariables,
        },
      })
    : await resend.emails.send({
        from: FROM_EMAIL,
        to: [params.email],
        subject: copy.subject(ownerName),
        html: copy.inlineHtml({
          beneficiaryName: params.beneficiaryName,
          ownerName: params.ownerName ?? null,
          verificationUrl,
          expiryHours: TOKEN_TTL_HOURS,
        }),
      });

  if (emailError) {
    console.error('Error sending beneficiary verification email:', emailError);
    return { sent: false, error: emailError.message };
  }

  return { sent: true };
}

export type VerifyBeneficiaryEmailResult =
  | { ok: true; beneficiaryName: string }
  | { ok: false; reason: 'invalid' | 'expired' | 'used' };

export async function verifyBeneficiaryEmailToken(
  token: string
): Promise<VerifyBeneficiaryEmailResult> {
  const tokenHash = hashToken(token);
  const now = new Date().toISOString();

  const { data: record, error } = await supabaseAdmin
    .from('beneficiary_email_verifications')
    .select('id, beneficiary_id, expires_at, used_at, beneficiary:beneficiaries(full_name, email)')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (error || !record) {
    return { ok: false, reason: 'invalid' };
  }

  if (record.used_at) {
    return { ok: false, reason: 'used' };
  }

  if (record.expires_at < now) {
    return { ok: false, reason: 'expired' };
  }

  const beneficiary = Array.isArray(record.beneficiary)
    ? record.beneficiary[0]
    : record.beneficiary;

  const { error: markUsedError } = await supabaseAdmin
    .from('beneficiary_email_verifications')
    .update({ used_at: now })
    .eq('id', record.id);

  if (markUsedError) {
    console.error('Error marking verification token as used:', markUsedError);
    return { ok: false, reason: 'invalid' };
  }

  const { error: updateError } = await supabaseAdmin
    .from('beneficiaries')
    .update({
      email_verified: true,
      email_verified_at: now,
    })
    .eq('id', record.beneficiary_id);

  if (updateError) {
    console.error('Error updating beneficiary email_verified:', updateError);
    return { ok: false, reason: 'invalid' };
  }

  return {
    ok: true,
    beneficiaryName: beneficiary?.full_name ?? 'Beneficiary',
  };
}

export function getVerificationResultPath(
  status: 'success' | 'expired' | 'invalid' | 'used',
  locale?: string | null
): string {
  const resolved = resolveEmailLocale(locale);
  return `/${resolved}/verify-beneficiary-email?status=${status}`;
}
