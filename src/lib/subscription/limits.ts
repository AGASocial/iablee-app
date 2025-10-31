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

/**
 * Get user's subscription limits based on their active subscription
 */
export async function getSubscriptionLimits(
  supabase: SupabaseClient,
  userId: string
): Promise<SubscriptionLimits> {
  // Get active subscription with plan details
  const { data: subscription } = await supabase
    .from('billing_subscriptions')
    .select(`
      *,
      plan:billing_plans(*)
    `)
    .eq('user_id', userId)
    .eq('status', 'active')
    .single();

  // If no active subscription, return free tier limits
  if (!subscription || !subscription.plan) {
    return getFreeTrialLimits();
  }

  const plan = Array.isArray(subscription.plan) ? subscription.plan[0] : subscription.plan;
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

/**
 * Get free tier/trial limits
 */
export function getFreeTrialLimits(): SubscriptionLimits {
  return {
    maxAssets: 5,
    maxBeneficiaries: 2,
    maxStorageMb: 100,
    maxFileSizeMb: 10,
    prioritySupport: false,
    advancedSecurity: false,
  };
}

/**
 * Get user's current usage statistics
 */
export async function getUsageStats(
  supabase: SupabaseClient,
  userId: string
): Promise<UsageStats> {
  // Get assets count
  const { count: assetsCount } = await supabase
    .from('digital_assets')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId);

  // Get beneficiaries count
  const { count: beneficiariesCount } = await supabase
    .from('beneficiaries')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId);

  // For now, we'll set storage to 0 - this can be calculated from file sizes
  // when we implement actual file storage tracking
  const storageUsedMb = 0;

  return {
    assetsCount: assetsCount || 0,
    beneficiariesCount: beneficiariesCount || 0,
    storageUsedMb,
  };
}

/**
 * Check if user can create a new asset
 */
export async function canCreateAsset(
  supabase: SupabaseClient,
  userId: string
): Promise<{ allowed: boolean; reason?: string; limit?: number; current?: number }> {
  const [limits, usage] = await Promise.all([
    getSubscriptionLimits(supabase, userId),
    getUsageStats(supabase, userId),
  ]);

  // -1 means unlimited
  if (limits.maxAssets === -1) {
    return { allowed: true };
  }

  if (usage.assetsCount >= limits.maxAssets) {
    return {
      allowed: false,
      reason: 'Asset limit reached',
      limit: limits.maxAssets,
      current: usage.assetsCount,
    };
  }

  return { allowed: true };
}

/**
 * Check if user can create a new beneficiary
 */
export async function canCreateBeneficiary(
  supabase: SupabaseClient,
  userId: string
): Promise<{ allowed: boolean; reason?: string; limit?: number; current?: number }> {
  const [limits, usage] = await Promise.all([
    getSubscriptionLimits(supabase, userId),
    getUsageStats(supabase, userId),
  ]);

  // -1 means unlimited
  if (limits.maxBeneficiaries === -1) {
    return { allowed: true };
  }

  if (usage.beneficiariesCount >= limits.maxBeneficiaries) {
    return {
      allowed: false,
      reason: 'Beneficiary limit reached',
      limit: limits.maxBeneficiaries,
      current: usage.beneficiariesCount,
    };
  }

  return { allowed: true };
}

/**
 * Check if user's subscription is active
 */
export async function hasActiveSubscription(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  const { data: subscription } = await supabase
    .from('billing_subscriptions')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'active')
    .single();

  return !!subscription;
}

/**
 * Get subscription status for user
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
  const { data: subscription } = await supabase
    .from('billing_subscriptions')
    .select(`
      *,
      plan:billing_plans(*)
    `)
    .eq('user_id', userId)
    .eq('status', 'active')
    .single();

  const [limits, usage] = await Promise.all([
    getSubscriptionLimits(supabase, userId),
    getUsageStats(supabase, userId),
  ]);

  if (!subscription) {
    return {
      hasSubscription: false,
      limits,
      usage,
    };
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
