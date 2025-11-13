import {
  Mail,
  Mic,
  Camera,
  Video,
  File,
  LucideIcon
} from "lucide-react";
import {
  getAssetTypes,
  getAssetType,
  getAssetTypeKeys,
  getAssetTypeLabels,
  getAssetTypesJson,
  getAvailableAssetTypes,
  type AssetType as DatabaseAssetType
} from '../lib/assetTypes';

// Re-export the database AssetType interface with LucideIcon for backward compatibility
export interface AssetType extends Omit<DatabaseAssetType, 'icon'> {
  icon: LucideIcon;
}

// Icon mapping for backward compatibility
const ICON_MAP: Record<string, LucideIcon> = {
  Mail,
  Mic,
  Camera,
  Video,
  File,
};

// Convert database AssetType to legacy AssetType with LucideIcon
function convertToLegacyAssetType(dbAssetType: DatabaseAssetType): AssetType {
  return {
    ...dbAssetType,
    icon: ICON_MAP[dbAssetType.icon] || File, // Fallback to File icon
  };
}

// Legacy synchronous functions - these will now fetch from database
// Note: These are now async and should be used accordingly

/**
 * @deprecated Use getAssetTypes() from '../lib/assetTypes' instead
 * This function now fetches from database and may be slower
 */
export async function getLegacyAssetTypes(): Promise<AssetType[]> {
  const dbAssetTypes = await getAssetTypes();
  return dbAssetTypes.map(convertToLegacyAssetType);
}

/**
 * @deprecated Use getAssetType() from '../lib/assetTypes' instead
 */
export async function getLegacyAssetType(key: string): Promise<AssetType | undefined> {
  const dbAssetType = await getAssetType(key);
  return dbAssetType ? convertToLegacyAssetType(dbAssetType) : undefined;
}

/**
 * @deprecated Use getAssetTypeKeys() from '../lib/assetTypes' instead
 */
export const getAssetTypeKeysLegacy = getAssetTypeKeys;

/**
 * @deprecated Use getAssetTypeLabels() from '../lib/assetTypes' instead
 */
export const getAssetTypeLabelsLegacy = getAssetTypeLabels;

/**
 * @deprecated Use getAssetTypesJson() from '../lib/assetTypes' instead
 */
export const getAssetTypesJsonLegacy = getAssetTypesJson;

// Re-export database functions with better names
export {
  getAssetTypes,
  getAssetType,
  getAssetTypeKeys,
  getAssetTypeLabels,
  getAssetTypesJson,
  getAvailableAssetTypes,
  type DatabaseAssetType
};

// For backward compatibility, provide a synchronous getter that returns empty array
// Components should migrate to use the async functions
export const ASSET_TYPES: AssetType[] = [];

// Helper function to get asset type by key (legacy synchronous version)
export const getAssetTypeSync = (key: string): AssetType | undefined => {
  // This will be empty until migrated to async
  return ASSET_TYPES.find(type => type.key === key);
};
