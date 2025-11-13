import { supabase } from './supabase';
import { Database } from './supabase';

type AssetTypeRow = Database['public']['Tables']['asset_types']['Row'];

export interface AssetType {
  id: string;
  key: string;
  label: string;
  icon: string;
  description?: string;
  requiredFields: string[];
  optionalFields: string[];
  fileAccept?: string;
  customFields: {
    key: string;
    label: string;
    type: 'text' | 'textarea' | 'file' | 'select';
    required?: boolean;
    options?: string[];
  }[];
  displayOrder: number;
  isActive: boolean;
}

/**
 * Fetch all active asset types from the database
 */
export async function getAssetTypes(): Promise<AssetType[]> {
  const { data, error } = await supabase
    .from('asset_types')
    .select('*')
    .eq('is_active', true)
    .order('display_order', { ascending: true });

  if (error) {
    console.error('Error fetching asset types:', error);
    throw error;
  }

  return data.map(transformAssetTypeFromDb);
}

/**
 * Fetch asset types available for a specific billing plan
 */
export async function getAssetTypesForPlan(planId: string): Promise<AssetType[]> {
  // First get the asset type IDs for this plan
  const { data: junctionData, error: junctionError } = await supabase
    .from('asset_type_billing_plans')
    .select('asset_type_id')
    .eq('billing_plan_id', planId);

  if (junctionError) {
    console.error('Error fetching asset type IDs for plan:', junctionError);
    throw junctionError;
  }

  if (!junctionData || junctionData.length === 0) {
    return [];
  }

  // Then fetch the actual asset types
  const assetTypeIds = junctionData.map(item => item.asset_type_id);
  const { data, error } = await supabase
    .from('asset_types')
    .select('*')
    .in('id', assetTypeIds)
    .eq('is_active', true)
    .order('display_order', { ascending: true });

  if (error) {
    console.error('Error fetching asset types:', error);
    throw error;
  }

  return data.map(transformAssetTypeFromDb);
}

/**
 * Get asset types available for the current user's plan
 */
export async function getAvailableAssetTypes(): Promise<AssetType[]> {
  try {
    // First get the current user's active subscription
    const { data: subscription, error: subError } = await supabase
      .from('billing_subscriptions')
      .select('plan_id')
      .eq('user_id', (await supabase.auth.getUser()).data.user?.id)
      .eq('status', 'active')
      .single();

    if (subError || !subscription) {
      // If no active subscription, return free plan asset types
      return await getAssetTypesForPlan('plan_free');
    }

    return await getAssetTypesForPlan(subscription.plan_id);
  } catch (error) {
    console.error('Error getting available asset types:', error);
    // Fallback to free plan
    return await getAssetTypesForPlan('plan_free');
  }
}

/**
 * Get a specific asset type by key
 */
export async function getAssetType(key: string): Promise<AssetType | undefined> {
  const { data, error } = await supabase
    .from('asset_types')
    .select('*')
    .eq('key', key)
    .eq('is_active', true)
    .single();

  if (error) {
    console.error('Error fetching asset type:', error);
    return undefined;
  }

  return transformAssetTypeFromDb(data);
}

/**
 * Transform database row to AssetType interface
 */
function transformAssetTypeFromDb(row: AssetTypeRow): AssetType {
  return {
    id: row.id,
    key: row.key,
    label: row.name,
    icon: row.icon,
    description: row.description || undefined,
    requiredFields: Array.isArray(row.required_fields) ? row.required_fields as string[] : [],
    optionalFields: Array.isArray(row.optional_fields) ? row.optional_fields as string[] : [],
    fileAccept: row.file_accept || undefined,
    customFields: Array.isArray(row.custom_fields) ? row.custom_fields as AssetType['customFields'] : [],
    displayOrder: row.display_order,
    isActive: row.is_active,
  };
}

/**
 * Helper functions for compatibility with existing code
 */
export async function getAssetTypeKeys(): Promise<string[]> {
  const assetTypes = await getAssetTypes();
  return assetTypes.map(type => type.key);
}

export async function getAssetTypeLabels(): Promise<string[]> {
  const assetTypes = await getAssetTypes();
  return assetTypes.map(type => type.label);
}

/**
 * JSON export for external systems (without icons)
 */
export async function getAssetTypesJson(): Promise<Array<{
  key: string;
  label: string;
  description?: string;
  requiredFields: string[];
  optionalFields: string[];
}>> {
  const assetTypes = await getAssetTypes();
  return assetTypes.map(type => ({
    key: type.key,
    label: type.label,
    description: type.description,
    requiredFields: type.requiredFields,
    optionalFields: type.optionalFields,
  }));
}
