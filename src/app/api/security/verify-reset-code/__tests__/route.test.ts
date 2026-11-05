/**
 * @jest-environment node
 */
import { POST } from '../route';
import { createAuthenticatedRouteClient } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { createSecuritySessionToken } from '@/lib/security';
import { resetRateLimitStore } from '@/lib/rate-limit';

jest.mock('@/lib/supabase-server', () => ({
  createAuthenticatedRouteClient: jest.fn(),
}));
jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { from: jest.fn(), rpc: jest.fn() },
}));
jest.mock('@/lib/security', () => ({
  createSecuritySessionToken: jest.fn().mockResolvedValue('reset-token'),
}));

function resetClaim(overrides: Record<string, unknown> = {}) {
  return {
    failed_attempts: 1,
    locked_until: null,
    already_locked: false,
    may_compare: true,
    pin_version: 2,
    ...overrides,
  };
}

describe('POST /api/security/verify-reset-code', () => {
  const userUpdate = jest.fn();
  const otpUpdate = jest.fn();
  const otpSelect = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    resetRateLimitStore();
    process.env.SUPABASE_JWT_SECRET = 'test-secret-that-is-long-enough-32';
    (createAuthenticatedRouteClient as jest.Mock).mockResolvedValue({
      user: { id: 'user-1' },
    });
    (supabaseAdmin.rpc as jest.Mock).mockResolvedValue({
      data: [resetClaim()],
      error: null,
    });
    userUpdate.mockImplementation(() => thenable());
    otpUpdate.mockImplementation(() => grantBuilder());
  });

  function thenable(resolved: { error: null | { message: string } } = { error: null }) {
    const builder: {
      eq: jest.Mock;
      gte: jest.Mock;
      select: jest.Mock;
      then: Promise<{ error: null | { message: string } }>['then'];
    } = {
      eq: jest.fn(),
      gte: jest.fn(),
      select: jest.fn(async () => ({ data: [{ id: 'user-1' }], error: null })),
      then: (onFulfilled, onRejected) => Promise.resolve(resolved).then(onFulfilled, onRejected),
    };
    builder.eq.mockReturnValue(builder);
    builder.gte.mockReturnValue(builder);
    return builder;
  }

  function grantBuilder() {
    const builder: {
      eq: jest.Mock;
      select: jest.Mock;
      maybeSingle: jest.Mock;
      then: Promise<{ error: null }>['then'];
    } = {
      eq: jest.fn(),
      select: jest.fn(),
      maybeSingle: jest.fn(async () => ({ data: { id: 'otp-1' }, error: null })),
      then: (onFulfilled, onRejected) => Promise.resolve({ error: null }).then(onFulfilled, onRejected),
    };
    builder.eq.mockReturnValue(builder);
    builder.select.mockReturnValue(builder);
    return builder;
  }

  function mockRows(options: { otp?: { id: string } | null }) {
    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'users') {
        return { update: userUpdate };
      }
      return {
        select: otpSelect.mockReturnValue({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                gt: () => ({
                  maybeSingle: async () => ({ data: options.otp ?? null, error: null }),
                }),
              }),
            }),
          }),
        }),
        update: otpUpdate,
      };
    });
  }

  function request(code = '000000') {
    return new Request('http://localhost/api/security/verify-reset-code', {
      method: 'POST',
      headers: { 'x-forwarded-for': '10.0.0.8' },
      body: JSON.stringify({ code }),
    });
  }

  it('rate limits like verify-pin', async () => {
    mockRows({});

    let response: Response | undefined;
    for (let i = 0; i < 6; i++) {
      response = await POST(request() as never);
    }

    expect(response?.status).toBe(429);
  });

  it('locks from the reservation and does not look up the OTP', async () => {
    mockRows({});
    const lockedUntil = new Date(Date.now() + 60_000).toISOString();
    (supabaseAdmin.rpc as jest.Mock).mockResolvedValue({
      data: [resetClaim({
        failed_attempts: 5,
        locked_until: lockedUntil,
        already_locked: false,
        may_compare: false,
      })],
      error: null,
    });

    const response = await POST(request('111111') as never);
    const body = await response.json();

    expect(response.status).toBe(423);
    expect(body.error).toMatch(/locked/i);
    expect(body.lockedUntil).toBe(lockedUntil);
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith('begin_pin_reset_attempt', {
      p_user_id: 'user-1',
    });
    expect(otpSelect).not.toHaveBeenCalled();
    expect(otpUpdate).toHaveBeenCalledWith(expect.objectContaining({ verified: true }));
    expect(userUpdate).not.toHaveBeenCalled();
    expect(createSecuritySessionToken).not.toHaveBeenCalled();
  });

  it('returns 500 when the lock cannot be taken', async () => {
    mockRows({});
    (supabaseAdmin.rpc as jest.Mock).mockResolvedValue({
      data: null,
      error: { message: 'db down' },
    });

    const response = await POST(request('111111') as never);

    expect(response.status).toBe(500);
    expect(otpSelect).not.toHaveBeenCalled();
    expect(createSecuritySessionToken).not.toHaveBeenCalled();
  });

  it('invalidates leftover codes while a reset lock is already active', async () => {
    const lockedUntil = new Date(Date.now() + 60_000).toISOString();
    mockRows({});
    (supabaseAdmin.rpc as jest.Mock).mockResolvedValue({
      data: [resetClaim({
        locked_until: lockedUntil,
        already_locked: true,
        may_compare: false,
      })],
      error: null,
    });

    const response = await POST(request('123456') as never);
    const body = await response.json();

    expect(response.status).toBe(423);
    expect(body.lockedUntil).toBe(lockedUntil);
    expect(otpUpdate).toHaveBeenCalledWith(expect.objectContaining({ verified: true }));
    expect(otpSelect).not.toHaveBeenCalled();
    expect(createSecuritySessionToken).not.toHaveBeenCalled();
  });

  it('still checks the fifth code and locks only when it does not match', async () => {
    const lockedUntil = '2026-11-05T12:15:00.000Z';
    mockRows({});
    (supabaseAdmin.rpc as jest.Mock).mockImplementation((fn: string) => {
      if (fn === 'finalize_failed_pin_attempt') {
        return Promise.resolve({
          data: [{ locked: true, locked_until: lockedUntil, failed_attempts: 5 }],
          error: null,
        });
      }
      return Promise.resolve({
        data: [resetClaim({ failed_attempts: 5, may_compare: true })],
        error: null,
      });
    });

    const response = await POST(request('111111') as never);
    const body = await response.json();

    expect(response.status).toBe(423);
    expect(body.remainingAttempts).toBe(0);
    expect(body.lockedUntil).toBe(lockedUntil);
    expect(body.error).toMatch(/locked/i);
    expect(otpSelect).toHaveBeenCalled();
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith('finalize_failed_pin_attempt', {
      p_user_id: 'user-1',
      p_scope: 'reset',
      p_compare_failed: true,
    });
    expect(userUpdate).not.toHaveBeenCalled();
    expect(createSecuritySessionToken).not.toHaveBeenCalled();
  });

  it('keeps one attempt visible after the fourth failed code', async () => {
    mockRows({});
    (supabaseAdmin.rpc as jest.Mock).mockResolvedValue({
      data: [resetClaim({ failed_attempts: 4, may_compare: true })],
      error: null,
    });

    const response = await POST(request('111111') as never);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.remainingAttempts).toBe(1);
    expect(otpSelect).toHaveBeenCalled();
    expect(userUpdate).not.toHaveBeenCalled();
    expect(supabaseAdmin.rpc).not.toHaveBeenCalledWith('finalize_failed_pin_attempt', expect.anything());
  });

  it('issues a single-use pin_reset grant for a matching hashed code', async () => {
    mockRows({ otp: { id: 'otp-1' } });

    const response = await POST(request('123456') as never);

    expect(response.status).toBe(200);
    const grantCall = otpUpdate.mock.calls
      .map((call) => call[0] as { reset_grant_id?: string; verified?: boolean })
      .find((payload) => payload.reset_grant_id);
    expect(grantCall).toEqual(expect.objectContaining({ verified: true }));
    expect(grantCall?.reset_grant_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(createSecuritySessionToken).toHaveBeenCalledWith('user-1', 'pin_reset', {
      jti: grantCall?.reset_grant_id,
      pinVersion: 2,
    });
    const setCookie = response.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('security_session=reset-token');
    expect(setCookie.toLowerCase()).toContain('httponly');
    expect(setCookie.toLowerCase()).toContain('path=/');
    expect(setCookie.toLowerCase()).toContain('samesite=lax');
    expect(userUpdate).toHaveBeenCalledWith({
      pin_reset_failed_attempts: 0,
      pin_reset_locked_until: null,
    });
  });
});
