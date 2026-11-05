/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { POST } from '../route';
import { createRouteClient } from '@/lib/supabase-server';
import { consumeOpenPinResetGrants } from '@/lib/pin-reset-grants';

jest.mock('@/lib/supabase-server', () => ({
  createRouteClient: jest.fn(),
}));

jest.mock('@/lib/pin-reset-grants', () => ({
  consumeOpenPinResetGrants: jest.fn().mockResolvedValue(true),
}));

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(() => ({ allowed: true, resetAt: 0 })),
  getClientIp: jest.fn(() => '127.0.0.1'),
  rateLimitResponse: jest.fn(),
  RATE_LIMITS: { auth: { windowMs: 1, max: 1 } },
}));

jest.mock('next/headers', () => ({
  cookies: jest.fn(),
}));

describe('POST /api/auth/login', () => {
  const mockCreateRouteClient = createRouteClient as jest.Mock;
  const mockCookies = cookies as jest.Mock;

  function loginRequest() {
    return new NextRequest('http://localhost/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'a@example.com', password: 'secret' }),
      headers: { 'content-type': 'application/json' },
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('clears security_session after a successful login', async () => {
    const setCookie = jest.fn();
    mockCookies.mockResolvedValue({ set: setCookie });
    mockCreateRouteClient.mockResolvedValue({
      auth: {
        signInWithPassword: jest.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
          error: null,
        }),
      },
    });

    const response = await POST(loginRequest());

    expect(response.status).toBe(200);
    expect(consumeOpenPinResetGrants).toHaveBeenCalledWith('user-1');
    expect(setCookie).toHaveBeenCalledWith('security_session', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    });
  });

  it('keeps security_session when login fails', async () => {
    const setCookie = jest.fn();
    mockCookies.mockResolvedValue({ set: setCookie });
    mockCreateRouteClient.mockResolvedValue({
      auth: {
        signInWithPassword: jest.fn().mockResolvedValue({ error: { message: 'Invalid login' } }),
      },
    });

    const response = await POST(loginRequest());

    expect(response.status).toBe(401);
    expect(setCookie).not.toHaveBeenCalled();
    expect(consumeOpenPinResetGrants).not.toHaveBeenCalled();
  });

  it('signs out and clears auth cookies when the PIN reset grant cannot be consumed', async () => {
    const setCookie = jest.fn();
    const signOut = jest.fn().mockResolvedValue({ error: null });
    mockCookies.mockResolvedValue({
      set: setCookie,
      getAll: () => [{ name: 'sb-ref-auth-token', value: 'live-session' }],
    });
    mockCreateRouteClient.mockResolvedValue({
      auth: {
        signInWithPassword: jest.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
          error: null,
        }),
        signOut,
      },
    });
    (consumeOpenPinResetGrants as jest.Mock).mockResolvedValue(false);

    const response = await POST(loginRequest());

    expect(response.status).toBe(500);
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(setCookie).toHaveBeenCalledWith('sb-ref-auth-token', '', expect.objectContaining({
      maxAge: 0,
      path: '/',
      sameSite: 'lax',
      httpOnly: false,
    }));
    expect(setCookie).toHaveBeenCalledWith('security_session', '', expect.objectContaining({
      maxAge: 0,
    }));
    const setCookieHeader = response.headers.get('set-cookie') ?? '';
    expect(setCookieHeader).toContain('sb-ref-auth-token=');
    expect(setCookieHeader.toLowerCase()).toContain('max-age=0');
    expect(setCookieHeader).not.toContain('live-session');
  });
});
