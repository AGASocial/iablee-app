/**
 * @jest-environment node
 */
import { POST } from '../route';
import { createAuthenticatedRouteClient } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import bcrypt from 'bcryptjs';
import { createSecuritySessionToken } from '@/lib/security';
import { checkRateLimit, resetRateLimitStore } from '@/lib/rate-limit';

jest.mock('@/lib/supabase-server', () => ({
  createAuthenticatedRouteClient: jest.fn(),
}));
jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { from: jest.fn(), rpc: jest.fn() },
}));
jest.mock('bcryptjs');
jest.mock('next/headers', () => ({
  cookies: jest.fn().mockResolvedValue({ set: jest.fn() }),
}));
jest.mock('@/lib/security', () => ({
  createSecuritySessionToken: jest.fn().mockResolvedValue('token'),
}));

function claim(overrides: Record<string, unknown> = {}) {
  return {
    pin_hash: 'hash',
    failed_attempts: 1,
    locked_until: null,
    already_locked: false,
    may_compare: true,
    pin_version: 3,
    ...overrides,
  };
}

describe('POST /api/security/verify-pin lockout', () => {
  const mockCreateAuthenticatedRouteClient = createAuthenticatedRouteClient as jest.Mock;
  const mockFrom = supabaseAdmin.from as jest.Mock;
  const mockRpc = supabaseAdmin.rpc as jest.Mock;
  const mockCompare = bcrypt.compare as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    resetRateLimitStore();
    mockCreateAuthenticatedRouteClient.mockResolvedValue({
      user: { id: 'user-1' },
    });
    mockRpc.mockResolvedValue({ data: [claim()], error: null });
  });

  it('returns 423 when the reserved attempt is already locked and does not compare', async () => {
    const lockedUntil = new Date(Date.now() + 60_000).toISOString();
    mockRpc.mockResolvedValue({
      data: [claim({
        pin_hash: null,
        failed_attempts: 5,
        locked_until: lockedUntil,
        already_locked: true,
        may_compare: false,
      })],
      error: null,
    });

    const request = new Request('http://localhost/api/security/verify-pin', {
      method: 'POST',
      body: JSON.stringify({ pin: '1234' }),
    });

    const response = await POST(request as never);
    const body = await response.json();

    expect(response.status).toBe(423);
    expect(body.error).toContain('locked');
    expect(body.lockedUntil).toBe(lockedUntil);
    expect(mockRpc).toHaveBeenCalledWith('begin_pin_attempt', { p_user_id: 'user-1' });
    expect(mockCompare).not.toHaveBeenCalled();
  });

  it('does not compare when this reservation reaches the lock', async () => {
    const lockedUntil = new Date(Date.now() + 60_000).toISOString();
    mockRpc.mockResolvedValue({
      data: [claim({
        pin_hash: null,
        failed_attempts: 5,
        locked_until: lockedUntil,
        already_locked: false,
        may_compare: false,
      })],
      error: null,
    });

    const request = new Request('http://localhost/api/security/verify-pin', {
      method: 'POST',
      body: JSON.stringify({ pin: '1234' }),
    });

    const response = await POST(request as never);

    expect(response.status).toBe(423);
    expect(mockCompare).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalledWith('record_pin_failed_attempt', expect.anything());
  });

  it('counts a wrong PIN from the reservation and does not increment again', async () => {
    const update = jest.fn().mockReturnThis();
    mockFrom.mockReturnValue({ update, eq: jest.fn() });
    mockRpc.mockResolvedValue({
      data: [claim({ failed_attempts: 4, may_compare: true })],
      error: null,
    });
    mockCompare.mockResolvedValue(false);

    const request = new Request('http://localhost/api/security/verify-pin', {
      method: 'POST',
      body: JSON.stringify({ pin: '0000' }),
    });

    const response = await POST(request as never);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.remainingAttempts).toBe(1);
    expect(mockRpc).toHaveBeenCalledWith('begin_pin_attempt', { p_user_id: 'user-1' });
    expect(mockRpc).not.toHaveBeenCalledWith('record_pin_failed_attempt', expect.anything());
    expect(mockRpc).not.toHaveBeenCalledWith('finalize_failed_pin_attempt', expect.anything());
    expect(mockCompare).toHaveBeenCalledWith('0000', 'hash');
    expect(update).not.toHaveBeenCalled();
  });

  it('compares the fifth PIN and locks only when it is wrong', async () => {
    const lockedUntil = '2026-11-05T12:15:00.000Z';
    mockRpc.mockImplementation((fn: string) => {
      if (fn === 'finalize_failed_pin_attempt') {
        return Promise.resolve({
          data: [{ locked: true, locked_until: lockedUntil, failed_attempts: 5 }],
          error: null,
        });
      }
      return Promise.resolve({
        data: [claim({ failed_attempts: 5, may_compare: true, pin_hash: 'hash' })],
        error: null,
      });
    });
    mockCompare.mockResolvedValue(false);

    const request = new Request('http://localhost/api/security/verify-pin', {
      method: 'POST',
      body: JSON.stringify({ pin: '000000' }),
    });

    const response = await POST(request as never);
    const body = await response.json();

    expect(response.status).toBe(423);
    expect(body.remainingAttempts).toBe(0);
    expect(body.lockedUntil).toBe(lockedUntil);
    expect(mockCompare).toHaveBeenCalledWith('000000', 'hash');
    expect(mockRpc).toHaveBeenCalledWith('finalize_failed_pin_attempt', {
      p_user_id: 'user-1',
      p_scope: 'pin',
      p_compare_failed: true,
    });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('returns 500 when the fifth-failure lock cannot be stored', async () => {
    mockRpc.mockImplementation((fn: string) => {
      if (fn === 'finalize_failed_pin_attempt') {
        return Promise.resolve({ data: null, error: { message: 'db down' } });
      }
      return Promise.resolve({
        data: [claim({ failed_attempts: 5, may_compare: true, pin_hash: 'hash' })],
        error: null,
      });
    });
    mockCompare.mockResolvedValue(false);

    const request = new Request('http://localhost/api/security/verify-pin', {
      method: 'POST',
      body: JSON.stringify({ pin: '000000' }),
    });

    const response = await POST(request as never);

    expect(response.status).toBe(500);
    expect(mockCompare).toHaveBeenCalledWith('000000', 'hash');
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('accepts a correct fifth PIN without locking', async () => {
    const eq = jest.fn().mockResolvedValue({ error: null });
    const update = jest.fn().mockReturnValue({ eq });
    mockFrom.mockReturnValue({ update });
    mockRpc.mockResolvedValue({
      data: [claim({ failed_attempts: 5, may_compare: true })],
      error: null,
    });
    mockCompare.mockResolvedValue(true);

    const request = new Request('http://localhost/api/security/verify-pin', {
      method: 'POST',
      body: JSON.stringify({ pin: '123456' }),
    });

    const response = await POST(request as never);

    expect(response.status).toBe(200);
    expect(mockCompare).toHaveBeenCalledWith('123456', 'hash');
    expect(update).toHaveBeenCalledWith({ pin_failed_attempts: 0, pin_locked_until: null });
  });

  it('does not invent a local attempt count when the lock fails', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'db down' } });
    mockCompare.mockResolvedValue(false);

    const request = new Request('http://localhost/api/security/verify-pin', {
      method: 'POST',
      body: JSON.stringify({ pin: '0000' }),
    });

    const response = await POST(request as never);

    expect(response.status).toBe(500);
    expect(mockCompare).not.toHaveBeenCalled();
  });

  it('issues a session carrying the current PIN version after a match', async () => {
    const eq = jest.fn().mockResolvedValue({ error: null });
    mockFrom.mockReturnValue({
      update: jest.fn().mockReturnValue({ eq }),
    });
    mockCompare.mockResolvedValue(true);

    const request = new Request('http://localhost/api/security/verify-pin', {
      method: 'POST',
      body: JSON.stringify({ pin: '1234' }),
    });

    const response = await POST(request as never);

    expect(response.status).toBe(200);
    expect(mockCompare).toHaveBeenCalledWith('1234', 'hash');
    expect(createSecuritySessionToken).toHaveBeenCalledWith('user-1', 'pin_verified', {
      pinVersion: 3,
    });
  });

  it('returns 429 when rate limited', async () => {
    for (let i = 0; i < 5; i++) {
      checkRateLimit('security:verify-pin:127.0.0.1', { limit: 5, windowSec: 60 });
    }

    const request = new Request('http://localhost/api/security/verify-pin', {
      method: 'POST',
      headers: { 'x-forwarded-for': '127.0.0.1' },
      body: JSON.stringify({ pin: '1234' }),
    });

    const response = await POST(request as never);

    expect(response.status).toBe(429);
    expect(mockCompare).not.toHaveBeenCalled();
  });
});
