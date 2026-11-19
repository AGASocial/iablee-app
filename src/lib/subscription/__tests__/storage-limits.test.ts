import {
  PREMIUM_TOTAL_STORAGE_BYTES,
  PREMIUM_TOTAL_STORAGE_MB,
} from '@/lib/subscription/storage-limits';

describe('PREMIUM_TOTAL_STORAGE_* constants (KAN-168)', () => {
  it('defines a single 5 GB Premium cap as 5000 MB', () => {
    expect(PREMIUM_TOTAL_STORAGE_MB).toBe(5000);
    expect(PREMIUM_TOTAL_STORAGE_BYTES).toBe(5000 * 1024 * 1024);
  });
});
