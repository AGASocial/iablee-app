/**
 * @jest-environment node
 */
import {
  acquireChargeLease,
  releaseChargeLease,
  CHARGE_LEASE_TTL_SECONDS,
} from '../charge-leases';
import { REQUIRES_REFUND_FLAG_PENDING } from '../renewals';

describe('charge leases', () => {
  it('exposes a ~5 minute TTL', () => {
    expect(CHARGE_LEASE_TTL_SECONDS).toBe(300);
  });

  it('acquire returns false when RPC says contention', async () => {
    const supabase = {
      rpc: jest.fn(async () => ({ data: false, error: null })),
    };
    await expect(
      acquireChargeLease(supabase as never, 'user-1', 'holder-a')
    ).resolves.toBe(false);
    expect(supabase.rpc).toHaveBeenCalledWith(
      'acquire_billing_charge_lease',
      expect.objectContaining({
        p_user_id: 'user-1',
        p_holder: 'holder-a',
        p_ttl_seconds: 300,
      })
    );
  });

  it('acquire returns true when RPC grants the lease', async () => {
    const supabase = {
      rpc: jest.fn(async () => ({ data: true, error: null })),
    };
    await expect(
      acquireChargeLease(supabase as never, 'user-1', 'holder-a')
    ).resolves.toBe(true);
  });

  it('release calls RPC with matching holder', async () => {
    const supabase = {
      rpc: jest.fn(async () => ({ data: null, error: null })),
    };
    await releaseChargeLease(supabase as never, 'user-1', 'holder-a');
    expect(supabase.rpc).toHaveBeenCalledWith(
      'release_billing_charge_lease',
      expect.objectContaining({
        p_user_id: 'user-1',
        p_holder: 'holder-a',
      })
    );
  });
});

describe('REQUIRES_REFUND_FLAG_PENDING marker', () => {
  it('is a stable durable marker string', () => {
    expect(REQUIRES_REFUND_FLAG_PENDING).toBe('REQUIRES_REFUND_FLAG_PENDING');
  });
});
