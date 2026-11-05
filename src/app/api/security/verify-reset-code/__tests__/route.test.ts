/**
 * @jest-environment node
 */
import { POST } from '../route';
import { createAuthenticatedRouteClient } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { createSecuritySessionToken } from '@/lib/security';
import { resetRateLimitStore } from '@/lib/rate-limit';
import { PIN_LOCKOUT_MAX_ATTEMPTS } from '@/lib/pin-lockout';

jest.mock('@/lib/supabase-server', () => ({
  createAuthenticatedRouteClient: jest.fn(),
}));
jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { from: jest.fn() },
}));
jest.mock('@/lib/security', () => ({
  createSecuritySessionToken: jest.fn().mockResolvedValue('reset-token'),
}));

describe('POST /api/security/verify-reset-code', () => {
  const userUpdate = jest.fn();
  const otpUpdate = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    resetRateLimitStore();
    process.env.SUPABASE_JWT_SECRET = 'test-secret-that-is-long-enough-32';
    (createAuthenticatedRouteClient as jest.Mock).mockResolvedValue({
      user: { id: 'user-1' },
    });
    userUpdate.mockImplementation(() => thenable());
    otpUpdate.mockImplementation(() => thenable());
  });

  function thenable(resolved: { error: null } = { error: null }) {
    const builder: {
      eq: jest.Mock;
      then: Promise<{ error: null }>['then'];
    } = {
      eq: jest.fn(),
      then: (onFulfilled, onRejected) => Promise.resolve(resolved).then(onFulfilled, onRejected),
    };
    builder.eq.mockReturnValue(builder);
    return builder;
  }

  function mockRows(options: {
    attempts?: number;
    lockedUntil?: string | null;
    otp?: { id: string } | null;
  }) {
    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'users') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: {
                  pin_reset_failed_attempts: options.attempts ?? 0,
                  pin_reset_locked_until: options.lockedUntil ?? null,
                },
                error: null,
              }),
            }),
          }),
          update: userUpdate,
        };
      }
      return {
        select: () => ({
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

  it('locks the user and invalidates OTPs after repeated failures', async () => {
    mockRows({ attempts: PIN_LOCKOUT_MAX_ATTEMPTS - 1 });

    const response = await POST(request('111111') as never);
    const body = await response.json();

    expect(response.status).toBe(423);
    expect(body.error).toMatch(/locked/i);
    expect(userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ pin_reset_failed_attempts: PIN_LOCKOUT_MAX_ATTEMPTS })
    );
    expect(otpUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ verified: true })
    );
    expect(createSecuritySessionToken).not.toHaveBeenCalled();
  });

  it('issues a pin_reset session for a matching hashed code', async () => {
    mockRows({ otp: { id: 'otp-1' } });

    const response = await POST(request('123456') as never);

    expect(response.status).toBe(200);
    expect(createSecuritySessionToken).toHaveBeenCalledWith('user-1', 'pin_reset');
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
