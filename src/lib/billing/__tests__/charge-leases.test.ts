/**
 * @jest-environment node
 */
import {
  acquireChargeLease,
  releaseChargeLease,
  refreshChargeLease,
  configureChargeLeaseForTests,
  CHARGE_LEASE_TTL_SECONDS,
} from '../charge-leases';
import { REQUIRES_REFUND_FLAG_PENDING } from '../renewals';

describe('charge leases', () => {
  afterEach(() => {
    // Restore suite default (jest.setup also sets this)
    configureChargeLeaseForTests({ alwaysGrant: true });
  });

  it('exposes a ~10 minute TTL (cron maxDuration + margin)', () => {
    expect(CHARGE_LEASE_TTL_SECONDS).toBe(600);
  });

  it('acquire returns false when RPC says contention', async () => {
    configureChargeLeaseForTests({});
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
        p_ttl_seconds: 600,
      })
    );
  });

  it('acquire returns true when RPC grants the lease', async () => {
    configureChargeLeaseForTests({});
    const supabase = {
      rpc: jest.fn(async () => ({ data: true, error: null })),
    };
    await expect(
      acquireChargeLease(supabase as never, 'user-1', 'holder-a')
    ).resolves.toBe(true);
  });

  it('fail-closed when RPC errors (no client CAS fallback)', async () => {
    configureChargeLeaseForTests({});
    const supabase = {
      rpc: jest.fn(async () => ({
        data: null,
        error: { message: 'function missing' },
      })),
      from: jest.fn(() => {
        throw new Error('must not fall back to client CAS');
      }),
    };
    await expect(
      acquireChargeLease(supabase as never, 'user-1', 'holder-a')
    ).resolves.toBe(false);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('fail-closed when rpc is missing and client CAS is not injected', async () => {
    configureChargeLeaseForTests({});
    const supabase = {
      from: jest.fn(() => {
        throw new Error('must not use client CAS');
      }),
    };
    await expect(
      acquireChargeLease(supabase as never, 'user-1', 'holder-a')
    ).resolves.toBe(false);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('refresh re-acquires with same holder via RPC', async () => {
    configureChargeLeaseForTests({});
    const supabase = {
      rpc: jest.fn(async () => ({ data: true, error: null })),
    };
    await expect(
      refreshChargeLease(supabase as never, 'user-1', 'holder-a')
    ).resolves.toBe(true);
    expect(supabase.rpc).toHaveBeenCalledWith(
      'acquire_billing_charge_lease',
      expect.objectContaining({ p_holder: 'holder-a' })
    );
  });

  it('release calls RPC with matching holder', async () => {
    configureChargeLeaseForTests({});
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
