import type { Database } from './supabase';

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
 * Fetch all active asset types via API route
 */
export async function getAssetTypes(): Promise<AssetType[]> {
  const res = await fetch('/api/asset-types');
  if (!res.ok) {
    console.error('Error fetching asset types');
    throw new Error('Failed to fetch asset types');
  }
  const data: AssetTypeRow[] = await res.json();
  return data.map(transformAssetTypeFromDb);
}

/**
 * Get asset types available for the current user's plan
 * (Server handles subscription lookup and plan filtering)
 */
export async function getAvailableAssetTypes(): Promise<AssetType[]> {
  const res = await fetch('/api/asset-types');
  if (!res.ok) {
    console.error('Error fetching available asset types');
    throw new Error('Failed to fetch asset types');
  }
  const data: AssetTypeRow[] = await res.json();
  return data.map(transformAssetTypeFromDb);
}

/**
 * Get a specific asset type by key
 */
export async function getAssetType(key: string): Promise<AssetType | undefined> {
  const res = await fetch(`/api/asset-types?key=${encodeURIComponent(key)}`);
  if (!res.ok) {
    console.error('Error fetching asset type');
    return undefined;
  }
  const data: AssetTypeRow = await res.json();
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
