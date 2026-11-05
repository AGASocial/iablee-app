import { createHash, randomBytes } from 'crypto';
import { Resend } from 'resend';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthRedirectOrigin } from '@/lib/app-url';
import {
  escapeHtml,
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

function normalizeEmail(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase();
}

function buildVerificationUrl(token: string, locale: EmailLocale): string {
  const appUrl = getAuthRedirectOrigin();
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
      email: normalizeEmail(params.email),
    });

  if (insertError) {
    console.error('Error storing beneficiary verification token:', insertError);
    return { sent: false, error: 'Failed to create verification token' };
  }

  const verificationUrl = buildVerificationUrl(token, locale);
  const ownerName = params.ownerName ?? copy.ownerFallback;

  const templateVariables = {
    BENEFICIARY_NAME: escapeHtml(params.beneficiaryName),
    OWNER_NAME: escapeHtml(ownerName),
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
    return { sent: false, error: 'Failed to send verification email' };
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
  const { data, error } = await supabaseAdmin.rpc('verify_beneficiary_email', {
    p_token_hash: tokenHash,
  });

  if (error) {
    console.error('Error verifying beneficiary email:', error);
    return { ok: false, reason: 'invalid' };
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | { status?: string; beneficiary_name?: string | null }
    | null
    | undefined;

  if (!row || row.status === 'invalid' || !row.status) {
    return { ok: false, reason: 'invalid' };
  }
  if (row.status === 'expired' || row.status === 'used') {
    return { ok: false, reason: row.status };
  }
  if (row.status === 'success') {
    return { ok: true, beneficiaryName: row.beneficiary_name || 'Beneficiary' };
  }

  return { ok: false, reason: 'invalid' };
}

export function getVerificationResultPath(
  status: 'success' | 'expired' | 'invalid' | 'used',
  locale?: string | null
): string {
  const resolved = resolveEmailLocale(locale);
  return `/${resolved}/verify-beneficiary-email?status=${status}`;
}
