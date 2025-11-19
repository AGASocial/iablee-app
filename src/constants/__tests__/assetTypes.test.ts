import { getAssetType, getAssetTypeKeys, getAssetTypeLabels, ASSET_TYPES } from '../assetTypes';

describe('assetTypes', () => {
  describe('ASSET_TYPES', () => {
    it('should have at least one asset type', () => {
      expect(ASSET_TYPES.length).toBeGreaterThan(0);
    });

    it('should have valid asset type structure', () => {
      ASSET_TYPES.forEach(type => {
        expect(type).toHaveProperty('key');
        expect(type).toHaveProperty('label');
        expect(type).toHaveProperty('icon');
        expect(typeof type.key).toBe('string');
        expect(typeof type.label).toBe('string');
      });
    });

    it('should have unique keys', () => {
      const keys = ASSET_TYPES.map(t => t.key);
      const uniqueKeys = new Set(keys);
      expect(uniqueKeys.size).toBe(keys.length);
    });
  });

  describe('getAssetType', () => {
    it('should return asset type for valid key', () => {
      const assetType = getAssetType('cartas');
      expect(assetType).toBeDefined();
      expect(assetType?.key).toBe('cartas');
    });

    it('should return undefined for invalid key', () => {
      const assetType = getAssetType('invalid-key');
      expect(assetType).toBeUndefined();
    });

    it('should handle empty string', () => {
      const assetType = getAssetType('');
      expect(assetType).toBeUndefined();
    });
  });

  describe('getAssetTypeKeys', () => {
    it('should return array of keys', () => {
      const keys = getAssetTypeKeys();
      expect(Array.isArray(keys)).toBe(true);
      expect(keys.length).toBeGreaterThan(0);
    });

    it('should return all asset type keys', () => {
      const keys = getAssetTypeKeys();
      expect(keys.length).toBe(ASSET_TYPES.length);
      keys.forEach(key => {
        expect(typeof key).toBe('string');
      });
    });
  });

  describe('getAssetTypeLabels', () => {
    it('should return array of labels', () => {
      const labels = getAssetTypeLabels();
      expect(Array.isArray(labels)).toBe(true);
      expect(labels.length).toBeGreaterThan(0);
    });

    it('should return all asset type labels', () => {
      const labels = getAssetTypeLabels();
      expect(labels.length).toBe(ASSET_TYPES.length);
      labels.forEach(label => {
        expect(typeof label).toBe('string');
      });
    });
  });
});



