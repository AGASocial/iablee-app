/**
 * Shared 413 payload for storage quota failures (KAN-168).
 */

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSubscriptionLimits, getUsageStats } from '@/lib/subscription/limits';

export function isStorageQuotaDbError(message: string | undefined | null): boolean {
  return typeof message === 'string' && message.includes('STORAGE_QUOTA');
}

export async function storageLimitReachedResponse(
  supabase: SupabaseClient,
  userId: string,
  opts?: { limit?: number; current?: number }
): Promise<NextResponse> {
  let limit = opts?.limit;
  let current = opts?.current;

  if (limit == null || current == null) {
    const [limits, usage] = await Promise.all([
      getSubscriptionLimits(supabase, userId),
      getUsageStats(supabase, userId),
    ]);
    limit = limit ?? limits.maxStorageMb;
    current = current ?? usage.storageUsedMb;
  }

  return NextResponse.json(
    {
      error: 'storageLimitReached',
      code: 'storageLimitReached',
      limit,
      current,
    },
    { status: 413 }
  );
}
