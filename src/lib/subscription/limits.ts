/**
 * Subscription limits and feature gating utilities
 */

import { SupabaseClient } from '@supabase/supabase-js';

export interface SubscriptionLimits {
  maxAssets: number;
  maxBeneficiaries: number;
  maxStorageMb: number;
  maxFileSizeMb: number;
  prioritySupport: boolean;
  advancedSecurity: boolean;
}

export interface UsageStats {
  assetsCount: number;
  beneficiariesCount: number;
  storageUsedMb: number;
}

interface PlanRecord {
  id: string;
  name: string;
  features: Record<string, unknown>;
}

interface SubscriptionRecord {
  status: string;
  plan: PlanRecord | PlanRecord[] | null;
}

/** Per-request cache to avoid duplicate subscription fetches within a single handler */
const requestCache = new Map<string, { subscription: SubscriptionRecord | null; limits: SubscriptionLimits; ts: number }>();
const CACHE_TTL_MS = 5000;

function getCached(userId: string) {
  const entry = requestCache.get(userId);
  if (entry && Date.now() - entry.ts < CACHE_TTL_MS) {
    return entry;
  }
  return null;
}

function setCache(userId: string, subscription: SubscriptionRecord | null, limits: SubscriptionLimits) {
  requestCache.set(userId, { subscription, limits, ts: Date.now() });
}

async function fetchActiveSubscription(
  supabase: SupabaseClient,
  userId: string
): Promise<SubscriptionRecord | null> {
  const { data: subscription } = await supabase
    .from('billing_subscriptions')
    .select(`status, plan:billing_plans(id, name, features)`)
    .eq('user_id', userId)
    .eq('status', 'active')
    .single();

  return subscription as SubscriptionRecord | null;
}

function limitsFromPlan(plan: PlanRecord | null): SubscriptionLimits {
  if (!plan) {
    return getFreeTrialLimits();
  }

  const features = plan.features as Record<string, unknown>;
  return {
    maxAssets: (features.max_assets as number) || 0,
    maxBeneficiaries: (features.max_beneficiaries as number) || 0,
    maxStorageMb: (features.max_storage_mb as number) || 100,
    maxFileSizeMb: (features.max_file_size_mb as number) || 10,
    prioritySupport: (features.priority_support as boolean) || false,
    advancedSecurity: (features.advanced_security as boolean) || false,
  };
}

async function fetchFreePlanLimits(supabase: SupabaseClient): Promise<SubscriptionLimits> {
  const { data: freePlan } = await supabase
    .from('billing_plans')
    .select('*')
    .eq('id', 'plan_free')
    .single();

  if (freePlan) {
    const features = freePlan.features as Record<string, unknown>;
    return {
      maxAssets: (features.max_assets as number) || 3,
      maxBeneficiaries: (features.max_beneficiaries as number) || 2,
      maxStorageMb: (features.max_storage_mb as number) || 50,
      maxFileSizeMb: (features.max_file_size_mb as number) || 10,
      prioritySupport: false,
      advancedSecurity: false,
    };
  }

  return getFreeTrialLimits();
}

/**
 * Get user's subscription limits based on their active subscription.
 * Reuses cached subscription when available within the same request window.
 */
export async function getSubscriptionLimits(
  supabase: SupabaseClient,
  userId: string
): Promise<SubscriptionLimits> {
  const cached = getCached(userId);
  if (cached) {
    return cached.limits;
  }

  const subscription = await fetchActiveSubscription(supabase, userId);

  let limits: SubscriptionLimits;
  if (!subscription || !subscription.plan) {
    limits = await fetchFreePlanLimits(supabase);
  } else {
    const plan = Array.isArray(subscription.plan) ? subscription.plan[0] : subscription.plan;
    limits = limitsFromPlan(plan);
  }

  setCache(userId, subscription, limits);
  return limits;
}

export function getFreeTrialLimits(): SubscriptionLimits {
  return {
    maxAssets: 3,
    maxBeneficiaries: 2,
    maxStorageMb: 50,
    maxFileSizeMb: 10,
    prioritySupport: false,
    advancedSecurity: false,
  };
}

export async function getUsageStats(
  supabase: SupabaseClient,
  userId: string
): Promise<UsageStats> {
  const [{ count: assetsCount }, { count: beneficiariesCount }, { data: storageRows }] =
    await Promise.all([
      supabase
        .from('digital_assets')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId),
      supabase
        .from('beneficiaries')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId),
      supabase
        .from('asset_attachments')
        .select('file_size, digital_assets!inner(user_id)')
        .eq('digital_assets.user_id', userId),
    ]);

  const totalBytes = (storageRows ?? []).reduce(
    (sum, row) => sum + (Number(row.file_size) || 0),
    0
  );

  return {
    assetsCount: assetsCount || 0,
    beneficiariesCount: beneficiariesCount || 0,
    storageUsedMb: Math.round((totalBytes / (1024 * 1024)) * 100) / 100,
  };
}

export async function canCreateAsset(
  supabase: SupabaseClient,
  userId: string
): Promise<{ allowed: boolean; reason?: string; limit?: number; current?: number }> {
  const [limits, usage] = await Promise.all([
    getSubscriptionLimits(supabase, userId),
    getUsageStats(supabase, userId),
  ]);

  if (limits.maxAssets === -1) {
    return { allowed: true };
  }

  if (usage.assetsCount >= limits.maxAssets) {
    return {
      allowed: false,
      reason: 'assetLimitReached',
      limit: limits.maxAssets,
      current: usage.assetsCount,
    };
  }

  return { allowed: true };
}

export async function canCreateBeneficiary(
  supabase: SupabaseClient,
  userId: string
): Promise<{ allowed: boolean; reason?: string; limit?: number; current?: number }> {
  const [limits, usage] = await Promise.all([
    getSubscriptionLimits(supabase, userId),
    getUsageStats(supabase, userId),
  ]);

  if (limits.maxBeneficiaries === -1) {
    return { allowed: true };
  }

  if (usage.beneficiariesCount >= limits.maxBeneficiaries) {
    return {
      allowed: false,
      reason: 'beneficiaryLimitReached',
      limit: limits.maxBeneficiaries,
      current: usage.beneficiariesCount,
    };
  }

  return { allowed: true };
}

export async function hasActiveSubscription(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  const cached = getCached(userId);
  if (cached) {
    return !!cached.subscription;
  }

  const subscription = await fetchActiveSubscription(supabase, userId);
  return !!subscription;
}

/**
 * Get subscription status for user — single subscription fetch, parallel usage counts.
 */
export async function getSubscriptionStatus(
  supabase: SupabaseClient,
  userId: string
): Promise<{
  hasSubscription: boolean;
  status?: string;
  planName?: string;
  limits: SubscriptionLimits;
  usage: UsageStats;
}> {
  const cached = getCached(userId);
  const subscription = cached?.subscription ?? await fetchActiveSubscription(supabase, userId);

  const [limits, usage] = await Promise.all([
    cached?.limits ?? (async () => {
      if (!subscription || !subscription.plan) {
        const freeLimits = await fetchFreePlanLimits(supabase);
        setCache(userId, subscription, freeLimits);
        return freeLimits;
      }
      const plan = Array.isArray(subscription.plan) ? subscription.plan[0] : subscription.plan;
      const derived = limitsFromPlan(plan);
      setCache(userId, subscription, derived);
      return derived;
    })(),
    getUsageStats(supabase, userId),
  ]);

  if (!subscription) {
    return { hasSubscription: false, limits, usage };
  }

  const plan = Array.isArray(subscription.plan) ? subscription.plan[0] : subscription.plan;

  return {
    hasSubscription: true,
    status: subscription.status,
    planName: plan?.name,
    limits,
    usage,
  };
}

/** Clear request cache (for tests) */
export function clearSubscriptionCache(): void {
  requestCache.clear();
}
