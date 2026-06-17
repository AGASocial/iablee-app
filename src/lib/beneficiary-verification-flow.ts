import { sendBeneficiaryVerificationEmail } from '@/lib/beneficiary-email-verification';
import { resolveEmailLocale } from '@/lib/beneficiary-email-copy';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase';

type Supabase = SupabaseClient<Database>;

export async function maybeSendBeneficiaryVerificationEmail(params: {
  supabase: Supabase;
  userId: string;
  beneficiaryId: string;
  beneficiaryName: string;
  email: string | null;
  emailChanged: boolean;
  isNew: boolean;
  locale?: string | null;
}): Promise<{ verificationSent: boolean }> {
  const { email, emailChanged, isNew } = params;

  if (!email?.trim()) {
    return { verificationSent: false };
  }

  if (!isNew && !emailChanged) {
    return { verificationSent: false };
  }

  const { data: owner } = await params.supabase
    .from('users')
    .select('full_name')
    .eq('id', params.userId)
    .single();

  const result = await sendBeneficiaryVerificationEmail({
    beneficiaryId: params.beneficiaryId,
    beneficiaryName: params.beneficiaryName,
    email: email.trim(),
    ownerName: owner?.full_name ?? null,
    locale: resolveEmailLocale(params.locale),
  });

  return { verificationSent: result.sent };
}
