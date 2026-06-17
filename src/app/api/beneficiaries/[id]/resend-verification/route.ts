import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedContext } from '@/lib/auth-context';
import { sendBeneficiaryVerificationEmail } from '@/lib/beneficiary-email-verification';
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getAuthenticatedContext();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const ip = getClientIp(request);
  const rateLimit = checkRateLimit(
    `beneficiary:resend-verification:${ip}`,
    RATE_LIMITS.beneficiaryEmail
  );
  if (!rateLimit.allowed) {
    return rateLimitResponse(rateLimit.resetAt);
  }

  const { supabase, user } = auth.ctx;
  const { id } = await params;

  let locale: string | undefined;
  try {
    const body = await request.json();
    locale = body.locale;
  } catch {
    locale = request.headers.get('x-locale') ?? undefined;
  }

  const userRateLimit = checkRateLimit(
    `beneficiary:resend-verification:user:${user.id}`,
    RATE_LIMITS.beneficiaryEmail
  );
  if (!userRateLimit.allowed) {
    return rateLimitResponse(userRateLimit.resetAt);
  }

  const { data: beneficiary, error } = await supabase
    .from('beneficiaries')
    .select('id, full_name, email, email_verified')
    .eq('id', id)
    .eq('user_id', user.id)
    .single();

  if (error || !beneficiary) {
    return NextResponse.json({ error: 'Beneficiary not found' }, { status: 404 });
  }

  if (!beneficiary.email) {
    return NextResponse.json({ error: 'Beneficiary has no email' }, { status: 400 });
  }

  if (beneficiary.email_verified) {
    return NextResponse.json({ error: 'Email already verified' }, { status: 400 });
  }

  const { data: owner } = await supabase
    .from('users')
    .select('full_name')
    .eq('id', user.id)
    .single();

  const result = await sendBeneficiaryVerificationEmail({
    beneficiaryId: beneficiary.id,
    beneficiaryName: beneficiary.full_name,
    email: beneficiary.email,
    ownerName: owner?.full_name ?? null,
    locale,
  });

  if (!result.sent) {
    return NextResponse.json(
      { error: result.error ?? 'Failed to send verification email' },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
