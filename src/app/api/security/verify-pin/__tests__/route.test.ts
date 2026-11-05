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
jest.mock('bcryptjs');
jest.mock('next/headers', () => ({
  cookies: jest.fn().mockResolvedValue({ set: jest.fn() }),
}));
jest.mock('@/lib/security', () => ({
  createSecuritySessionToken: jest.fn().mockResolvedValue('token'),
}));

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
  });

  it('returns 423 when account is locked', async () => {
    const lockedUntil = new Date(Date.now() + 60_000).toISOString();
    mockFrom.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: {
          security_pin_hash: 'hash',
          pin_failed_attempts: 5,
          pin_locked_until: lockedUntil,
        },
        error: null,
      }),
    });

    const request = new Request('http://localhost/api/security/verify-pin', {
      method: 'POST',
      body: JSON.stringify({ pin: '1234' }),
    });

    const response = await POST(request as never);
    const body = await response.json();

    expect(response.status).toBe(423);
    expect(body.error).toContain('locked');
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockCompare).not.toHaveBeenCalled();
  });

  it('increments failed attempts atomically and ignores the previously read count', async () => {
    const update = jest.fn().mockReturnThis();

    mockFrom.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: {
          security_pin_hash: 'hash',
          pin_failed_attempts: 0,
          pin_locked_until: null,
        },
        error: null,
      }),
      update,
    });
    mockRpc.mockResolvedValue({
      data: [{ failed_attempts: 4, locked_until: null, already_locked: false }],
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
    expect(mockRpc).toHaveBeenCalledWith('record_pin_failed_attempt', { p_user_id: 'user-1' });
    expect(update).not.toHaveBeenCalled();
  });

  it('does not invent a local attempt count when the atomic update fails', async () => {
    const update = jest.fn();
    mockFrom.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: {
          security_pin_hash: 'hash',
          pin_locked_until: null,
        },
        error: null,
      }),
      update,
    });
    mockRpc.mockResolvedValue({ data: null, error: { message: 'db down' } });
    mockCompare.mockResolvedValue(false);

    const request = new Request('http://localhost/api/security/verify-pin', {
      method: 'POST',
      body: JSON.stringify({ pin: '0000' }),
    });

    const response = await POST(request as never);

    expect(response.status).toBe(500);
    expect(update).not.toHaveBeenCalled();
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
  });
});
