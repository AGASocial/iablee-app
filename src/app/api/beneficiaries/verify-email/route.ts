import { NextRequest, NextResponse } from 'next/server';
import {
  getVerificationResultPath,
  verifyBeneficiaryEmailToken,
} from '@/lib/beneficiary-email-verification';
import { getAppUrl } from '@/lib/app-url';

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');
  const locale = request.nextUrl.searchParams.get('locale');

  if (!token) {
    return NextResponse.redirect(
      new URL(getVerificationResultPath('invalid', locale), getAppUrl())
    );
  }

  const result = await verifyBeneficiaryEmailToken(token);
  const status = result.ok ? 'success' : result.reason;

  return NextResponse.redirect(
    new URL(getVerificationResultPath(status, locale), getAppUrl())
  );
}
