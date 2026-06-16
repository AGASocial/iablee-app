import { createAuthenticatedRouteClient } from '@/lib/supabase-server';
import { getSubscriptionStatus } from '@/lib/subscription/limits';
import type { Asset } from '@/models/asset';
import type { Beneficiary } from '@/models/beneficiary';

export interface DashboardServerData {
  assets: Asset[];
  beneficiaries: Beneficiary[];
  stats: {
    totalAssets: number;
    totalBeneficiaries: number;
    protectedAssets: number;
    recentActivity: number;
  };
}

/**
 * Server-side dashboard fetch for RSC pages.
 * Mirrors GET /api/dashboard logic without an extra HTTP round-trip.
 */
export async function fetchDashboardData(): Promise<DashboardServerData | null> {
  const { supabase, user } = await createAuthenticatedRouteClient();
  if (!user) return null;

  const [
    { data: assetsData },
    { data: beneficiariesData },
    { count: totalAssets },
    { count: totalBeneficiaries },
    { count: protectedAssets },
  ] = await Promise.all([
    supabase
      .from('digital_assets')
      .select('*')
      .eq('user_id', user.id)
      .order('asset_name', { ascending: true })
      .limit(5),
    supabase
      .from('beneficiaries')
      .select('*')
      .eq('user_id', user.id)
      .order('full_name', { ascending: false })
      .limit(5),
    supabase
      .from('digital_assets')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id),
    supabase
      .from('beneficiaries')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id),
    supabase
      .from('digital_assets')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('status', 'protected'),
  ]);

  return {
    assets: (assetsData ?? []) as Asset[],
    beneficiaries: (beneficiariesData ?? []) as Beneficiary[],
    stats: {
      totalAssets: totalAssets ?? 0,
      totalBeneficiaries: totalBeneficiaries ?? 0,
      protectedAssets: protectedAssets ?? 0,
      recentActivity: 0,
    },
  };
}

/**
 * Resolves post-login redirect target with a single DB count query.
 */
export async function getPostLoginRedirect(): Promise<'/wizard' | '/dashboard'> {
  const { supabase, user } = await createAuthenticatedRouteClient();
  if (!user) return '/dashboard';

  const { count } = await supabase
    .from('digital_assets')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id);

  return count === 0 ? '/wizard' : '/dashboard';
}

export async function fetchSubscriptionStatusServer() {
  const { supabase, user } = await createAuthenticatedRouteClient();
  if (!user) return null;
  return getSubscriptionStatus(supabase, user.id);
}
