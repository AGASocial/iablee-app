/**
 * GET /api/cron/billing-renewals
 * Nightly Wompi renewals (Vercel Cron).
 * Auth: Authorization: Bearer ${CRON_SECRET} — fail closed, timing-safe.
 * Schedule: 07:00 UTC = 02:00 COT (see vercel.json).
 */

import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { getPaymentGateway, errorResponse, successResponse } from '@/lib/billing/server';
import { processWompiRenewals } from '@/lib/billing/renewals';
import type { WompiAdapter } from '@/lib/billing/adapters/wompi.adapter';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function timingSafeEqualString(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  if (aBuf.length !== bBuf.length) {
    return false;
  }
  try {
    return crypto.timingSafeEqual(aBuf, bBuf);
  } catch {
    return false;
  }
}

export function authorizeCronRequest(request: Request): Response | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('CRON_SECRET is not configured');
    return errorResponse('Cron not configured', 500);
  }

  const header = request.headers.get('authorization') || '';
  const expected = `Bearer ${secret}`;
  if (!timingSafeEqualString(header, expected)) {
    return errorResponse('Unauthorized', 401);
  }
  return null;
}

export async function GET(request: Request) {
  const denied = authorizeCronRequest(request);
  if (denied) return denied;

  try {
    const gateway = getPaymentGateway();
    if (gateway.getName() !== 'wompi') {
      return successResponse({
        skipped: true,
        reason: `PAYMENT_GATEWAY=${gateway.getName()} (renewals are Wompi-only)`,
      });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) {
      return errorResponse('Supabase not configured', 500);
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    const summary = await processWompiRenewals(
      supabase,
      gateway as WompiAdapter,
      { timeBudgetMs: 240_000 }
    );

    return successResponse({ ok: true, summary });
  } catch (error) {
    console.error(
      'billing-renewals cron failed:',
      error instanceof Error ? error.message : 'Unknown error'
    );
    return errorResponse('Cron failed', 500);
  }
}
