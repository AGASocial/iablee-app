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
  supabaseAdmin: { from: jest.fn() },
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
  });

  it('increments failed attempts on invalid PIN', async () => {
    const update = jest.fn().mockReturnThis();
    const eq = jest.fn().mockResolvedValue({ error: null });

    mockFrom.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: {
          security_pin_hash: 'hash',
          pin_failed_attempts: 2,
          pin_locked_until: null,
        },
        error: null,
      }),
      update,
    });
    update.mockReturnValue({ eq });
    mockCompare.mockResolvedValue(false);

    const request = new Request('http://localhost/api/security/verify-pin', {
      method: 'POST',
      body: JSON.stringify({ pin: '0000' }),
    });

    const response = await POST(request as never);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.remainingAttempts).toBe(2);
    expect(update).toHaveBeenCalledWith({ pin_failed_attempts: 3 });
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
