import { getAssetType, getAssetTypeKeys, getAssetTypeLabels, ASSET_TYPES } from '../assetTypes';

const MOCK_ASSET_TYPES = [
  {
    id: '1',
    key: 'cartas',
    name: 'Cartas',
    icon: 'Mail',
    description: null,
    required_fields: ['asset_name'],
    optional_fields: ['description'],
    file_accept: '*',
    custom_fields: [],
    display_order: 1,
    is_active: true,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  },
  {
    id: '2',
    key: 'audios',
    name: 'Audios',
    icon: 'Mic',
    description: null,
    required_fields: ['asset_name'],
    optional_fields: [],
    file_accept: 'audio/*',
    custom_fields: [],
    display_order: 2,
    is_active: true,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  },
];

beforeEach(() => {
  global.fetch = jest.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith('/api/asset-types?key=')) {
      const key = decodeURIComponent(url.split('=')[1] ?? '');
      const match = MOCK_ASSET_TYPES.find((assetType) => assetType.key === key);
      return Promise.resolve({
        ok: Boolean(match),
        json: async () => match,
      } as Response);
    }

    return Promise.resolve({
      ok: true,
      json: async () => MOCK_ASSET_TYPES,
    } as Response);
  }) as jest.Mock;
});

afterEach(() => {
  jest.resetAllMocks();
});

describe('assetTypes', () => {
  describe('ASSET_TYPES', () => {
    it('keeps legacy sync constant available for compatibility', () => {
      expect(Array.isArray(ASSET_TYPES)).toBe(true);
    });

    it('has unique keys when present', () => {
      const keys = ASSET_TYPES.map(t => t.key);
      const uniqueKeys = new Set(keys);
      expect(uniqueKeys.size).toBe(keys.length);
    });
  });

  describe('getAssetType', () => {
    it('should return asset type for valid key', async () => {
      const assetType = await getAssetType('cartas');
      expect(assetType).toBeDefined();
      expect(assetType?.key).toBe('cartas');
    });

    it('should return undefined for invalid key', async () => {
      const assetType = await getAssetType('invalid-key');
      expect(assetType).toBeUndefined();
    });

    it('should handle empty string', async () => {
      const assetType = await getAssetType('');
      expect(assetType).toBeUndefined();
    });
  });

  describe('getAssetTypeKeys', () => {
    it('should return array of keys', async () => {
      const keys = await getAssetTypeKeys();
      expect(Array.isArray(keys)).toBe(true);
      expect(keys.length).toBeGreaterThan(0);
    });

    it('should return all asset type keys', async () => {
      const keys = await getAssetTypeKeys();
      expect(keys.length).toBe(MOCK_ASSET_TYPES.length);
      keys.forEach(key => {
        expect(typeof key).toBe('string');
      });
    });
  });

  describe('getAssetTypeLabels', () => {
    it('should return array of labels', async () => {
      const labels = await getAssetTypeLabels();
      expect(Array.isArray(labels)).toBe(true);
      expect(labels.length).toBeGreaterThan(0);
    });

    it('should return all asset type labels', async () => {
      const labels = await getAssetTypeLabels();
      expect(labels.length).toBe(MOCK_ASSET_TYPES.length);
      labels.forEach(label => {
        expect(typeof label).toBe('string');
      });
    });
  });

  it('returns mapped asset types with valid structure', async () => {
    const keys = await getAssetTypeKeys();
    expect(keys.length).toBeGreaterThan(0);
  });
});

