/**
 * @jest-environment node
 */
import { POST } from '../route';
import { createAuthenticatedRouteClient } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import bcrypt from 'bcryptjs';
import { checkRateLimit, resetRateLimitStore } from '@/lib/rate-limit';

jest.mock('@/lib/supabase-server', () => ({
  createAuthenticatedRouteClient: jest.fn(),
}));
jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { from: jest.fn(), rpc: jest.fn() },
}));
jest.mock('bcryptjs', () => ({
  genSalt: jest.fn().mockResolvedValue('salt'),
  hash: jest.fn().mockResolvedValue('hashed-pin'),
  compare: jest.fn().mockResolvedValue(true),
}));

function updateChain(result: { data: { id: string }[] | null; error: { message: string } | null }) {
  const builder: {
    eq: jest.Mock;
    is: jest.Mock;
    select: jest.Mock;
  } = {
    eq: jest.fn(),
    is: jest.fn(),
    select: jest.fn(async () => result),
  };
  builder.eq.mockReturnValue(builder);
  builder.is.mockReturnValue(builder);
  return builder;
}

describe('POST /api/security/change-pin', () => {
  const userFrom = jest.fn();
  let chain: ReturnType<typeof updateChain>;

  beforeEach(() => {
    jest.clearAllMocks();
    resetRateLimitStore();
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    (createAuthenticatedRouteClient as jest.Mock).mockResolvedValue({
      user: { id: 'user-1' },
      supabase: { from: userFrom },
    });
    chain = updateChain({ data: [{ id: 'user-1' }], error: null });
    (supabaseAdmin.from as jest.Mock).mockImplementation(() => ({
      update: jest.fn().mockReturnValue(chain),
    }));
    (supabaseAdmin.rpc as jest.Mock).mockImplementation((fn: string) => {
      if (fn === 'begin_pin_attempt') {
        return Promise.resolve({
          data: [{
            pin_hash: 'current-hash',
            failed_attempts: 1,
            locked_until: null,
            already_locked: false,
            may_compare: true,
            pin_version: 2,
          }],
          error: null,
        });
      }
      if (fn === 'user_has_security_pin') {
        return Promise.resolve({ data: true, error: null });
      }
      return Promise.resolve({ data: null, error: { message: 'unexpected rpc' } });
    });
  });

  function request(body: Record<string, string>) {
    return new Request('http://localhost/api/security/change-pin', {
      method: 'POST',
      headers: { 'x-forwarded-for': '203.0.113.9' },
      body: JSON.stringify(body),
    });
  }

  it('writes the new hash through the service client after the current PIN matches', async () => {
    const response = await POST(request({ currentPin: '111111', newPin: '222222' }) as never);

    expect(response.status).toBe(200);
    expect(bcrypt.compare).toHaveBeenCalledWith('111111', 'current-hash');
    expect(supabaseAdmin.from).toHaveBeenCalledWith('users');
    expect(chain.eq).toHaveBeenCalledWith('id', 'user-1');
    expect(chain.eq).toHaveBeenCalledWith('security_pin_hash', 'current-hash');
    expect(userFrom).not.toHaveBeenCalled();
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith('begin_pin_attempt', { p_user_id: 'user-1' });
    expect(supabaseAdmin.rpc).not.toHaveBeenCalledWith('record_pin_failed_attempt', expect.anything());
  });

  it('requires the current PIN whenever a hash exists', async () => {
    const response = await POST(request({ newPin: '222222' }) as never);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/current PIN/i);
    expect(bcrypt.compare).not.toHaveBeenCalled();
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith('user_has_security_pin', { p_user_id: 'user-1' });
    expect(supabaseAdmin.rpc).not.toHaveBeenCalledWith('begin_pin_attempt', expect.anything());
  });

  it('returns 423 before comparing when the shared verify-pin lock is active', async () => {
    const lockedUntil = new Date(Date.now() + 60_000).toISOString();
    (supabaseAdmin.rpc as jest.Mock).mockResolvedValue({
      data: [{
        pin_hash: null,
        failed_attempts: 5,
        locked_until: lockedUntil,
        already_locked: true,
        may_compare: false,
        pin_version: 2,
      }],
      error: null,
    });

    const response = await POST(request({ currentPin: '111111', newPin: '222222' }) as never);
    const body = await response.json();

    expect(response.status).toBe(423);
    expect(body.error).toMatch(/locked/i);
    expect(body.lockedUntil).toBe(lockedUntil);
    expect(bcrypt.compare).not.toHaveBeenCalled();
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });

  it('counts a wrong PIN on the reserved attempt and does not compare after the cap', async () => {
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);
    (supabaseAdmin.rpc as jest.Mock).mockResolvedValue({
      data: [{
        pin_hash: 'current-hash',
        failed_attempts: 4,
        locked_until: null,
        already_locked: false,
        may_compare: true,
        pin_version: 2,
      }],
      error: null,
    });

    const response = await POST(request({ currentPin: '000000', newPin: '222222' }) as never);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.remainingAttempts).toBe(1);
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith('begin_pin_attempt', { p_user_id: 'user-1' });
    expect(supabaseAdmin.rpc).not.toHaveBeenCalledWith('record_pin_failed_attempt', expect.anything());
    expect(bcrypt.compare).toHaveBeenCalled();
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });

  it('uses the verify-pin rate limit bucket', async () => {
    for (let i = 0; i < 5; i++) {
      checkRateLimit('security:verify-pin:203.0.113.9', { limit: 5, windowSec: 60 });
    }

    const response = await POST(request({ currentPin: '111111', newPin: '222222' }) as never);

    expect(response.status).toBe(429);
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
    expect(bcrypt.compare).not.toHaveBeenCalled();
  });
});
