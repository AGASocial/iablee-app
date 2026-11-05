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

describe('POST /api/security/change-pin', () => {
  const userFrom = jest.fn();
  const update = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    resetRateLimitStore();
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    (createAuthenticatedRouteClient as jest.Mock).mockResolvedValue({
      user: { id: 'user-1' },
      supabase: { from: userFrom },
    });
    update.mockReturnValue({
      eq: jest.fn().mockResolvedValue({ error: null }),
    });
    (supabaseAdmin.rpc as jest.Mock).mockResolvedValue({
      data: [{
        failed_attempts: 1,
        locked_until: null,
        already_locked: false,
      }],
      error: null,
    });
  });

  function mockUser(row: { security_pin_hash: string | null; pin_locked_until: string | null }) {
    (supabaseAdmin.from as jest.Mock).mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: row, error: null }),
        }),
      }),
      update,
    }));
  }

  function request(body: Record<string, string>) {
    return new Request('http://localhost/api/security/change-pin', {
      method: 'POST',
      headers: { 'x-forwarded-for': '203.0.113.9' },
      body: JSON.stringify(body),
    });
  }

  it('writes the new hash through the service client after the current PIN matches', async () => {
    mockUser({ security_pin_hash: 'current-hash', pin_locked_until: null });

    const response = await POST(request({ currentPin: '111111', newPin: '222222' }) as never);

    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        security_pin_hash: 'hashed-pin',
        pin_failed_attempts: 0,
        pin_locked_until: null,
      })
    );
    expect(userFrom).not.toHaveBeenCalled();
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled();
  });

  it('requires the current PIN whenever a hash exists', async () => {
    mockUser({ security_pin_hash: 'current-hash', pin_locked_until: null });

    const response = await POST(request({ newPin: '222222' }) as never);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/current PIN/i);
    expect(bcrypt.compare).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('returns 423 while the shared verify-pin lock is active', async () => {
    const lockedUntil = new Date(Date.now() + 60_000).toISOString();
    mockUser({ security_pin_hash: 'current-hash', pin_locked_until: lockedUntil });

    const response = await POST(request({ currentPin: '111111', newPin: '222222' }) as never);
    const body = await response.json();

    expect(response.status).toBe(423);
    expect(body.error).toMatch(/locked/i);
    expect(body.lockedUntil).toBe(lockedUntil);
    expect(bcrypt.compare).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('counts a wrong PIN on the same atomic counter as verify-pin', async () => {
    mockUser({ security_pin_hash: 'current-hash', pin_locked_until: null });
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);
    (supabaseAdmin.rpc as jest.Mock).mockResolvedValue({
      data: [{ failed_attempts: 4, locked_until: null, already_locked: false }],
      error: null,
    });

    const response = await POST(request({ currentPin: '000000', newPin: '222222' }) as never);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.remainingAttempts).toBe(1);
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith('record_pin_failed_attempt', {
      p_user_id: 'user-1',
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('uses the verify-pin rate limit bucket', async () => {
    for (let i = 0; i < 5; i++) {
      checkRateLimit('security:verify-pin:203.0.113.9', { limit: 5, windowSec: 60 });
    }

    const response = await POST(request({ currentPin: '111111', newPin: '222222' }) as never);

    expect(response.status).toBe(429);
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });
});
