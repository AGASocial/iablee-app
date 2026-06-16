import { unstable_cache } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase-admin';

const CACHE_TAG = 'asset-types';
const REVALIDATE_SECONDS = 3600;

async function fetchAssetTypesForPlan(planId: string) {
  const { data: junctionData } = await supabaseAdmin
    .from('asset_type_billing_plans')
    .select('asset_type_id')
    .eq('billing_plan_id', planId);

  if (!junctionData?.length) return [];

  const assetTypeIds = junctionData.map((item) => item.asset_type_id);
  const { data } = await supabaseAdmin
    .from('asset_types')
    .select('*')
    .in('id', assetTypeIds)
    .eq('is_active', true)
    .order('display_order', { ascending: true });

  return data ?? [];
}

export const getCachedAssetTypesForPlan = unstable_cache(
  fetchAssetTypesForPlan,
  ['asset-types-by-plan'],
  { revalidate: REVALIDATE_SECONDS, tags: [CACHE_TAG] }
);

export const getCachedAssetTypeByKey = unstable_cache(
  async (key: string) => {
    const { data } = await supabaseAdmin
      .from('asset_types')
      .select('*')
      .eq('key', key)
      .eq('is_active', true)
      .single();
    return data;
  },
  ['asset-type-by-key'],
  { revalidate: REVALIDATE_SECONDS, tags: [CACHE_TAG] }
);
