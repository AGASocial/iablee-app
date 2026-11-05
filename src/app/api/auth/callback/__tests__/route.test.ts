/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { GET, sanitizeNextPath } from '../route';
import { createRouteClient } from '@/lib/supabase-server';
import { consumeOpenPinResetGrants } from '@/lib/pin-reset-grants';

jest.mock('@/lib/supabase-server', () => ({
  createRouteClient: jest.fn(),
}));

jest.mock('next/headers', () => ({
  cookies: jest.fn(),
}));

jest.mock('@/lib/pin-reset-grants', () => ({
  consumeOpenPinResetGrants: jest.fn().mockResolvedValue(true),
}));

const ORIGINAL_SITE_URL = process.env.NEXT_PUBLIC_SITE_URL;

describe('GET /api/auth/callback', () => {
  const mockCreateRouteClient = createRouteClient as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000';
    (consumeOpenPinResetGrants as jest.Mock).mockResolvedValue(true);
  });

  afterAll(() => {
    if (ORIGINAL_SITE_URL === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = ORIGINAL_SITE_URL;
  });

  function clientWithExchange(result: { data?: unknown; error: unknown }) {
    mockCreateRouteClient.mockResolvedValue({
      auth: {
        exchangeCodeForSession: jest.fn().mockResolvedValue(result),
        verifyOtp: jest.fn().mockResolvedValue(result),
      },
    });
  }

  it('clears security_session after a successful code exchange', async () => {
    clientWithExchange({ data: { user: { id: 'user-1' } }, error: null });

    const response = await GET(
      new NextRequest('http://evil.example/api/auth/callback?code=abc&next=/en/dashboard', {
        headers: {
          origin: 'https://evil.example',
          'x-forwarded-host': 'evil.example',
          'x-forwarded-proto': 'https',
        },
      })
    );

    expect(response.status).toBe(307);
    const setCookie = response.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('security_session=');
    expect(setCookie.toLowerCase()).toContain('max-age=0');
    expect(setCookie.toLowerCase()).toContain('httponly');
    expect(setCookie.toLowerCase()).toContain('path=/');
    expect(setCookie.toLowerCase()).toContain('samesite=lax');
    expect(response.headers.get('location')).toBe('http://localhost:3000/en/dashboard');
    expect(consumeOpenPinResetGrants).toHaveBeenCalledWith('user-1');
  });

  it('keeps post-login redirects on this origin', () => {
    const origin = 'https://iablee.com';
    expect(sanitizeNextPath('/en/dashboard?tab=1', origin)).toBe('/en/dashboard?tab=1');
    expect(sanitizeNextPath('https://evil.com', origin)).toBe('/en');
    expect(sanitizeNextPath('//evil.com', origin)).toBe('/en');
    expect(sanitizeNextPath('/\\evil.com', origin)).toBe('/en');
    expect(sanitizeNextPath('\\evil.com', origin)).toBe('/en');
    expect(sanitizeNextPath('/en/foo@bar', origin)).toBe('/en');
    expect(sanitizeNextPath('https://iablee.com@evil.com', origin)).toBe('/en');
    expect(sanitizeNextPath('/en/%5Csecret', origin)).toBe('/en');
    expect(sanitizeNextPath(null, origin)).toBe('/en');
  });

  it('does not redirect a backslash next path off-origin', async () => {
    clientWithExchange({ data: { user: { id: 'user-1' } }, error: null });

    const response = await GET(
      new NextRequest('http://localhost/api/auth/callback?code=abc&next=' + encodeURIComponent('/\\evil.com'))
    );

    expect(response.headers.get('location')).toBe('http://localhost:3000/en');
  });

  it('consumes reset grants after a magic-link exchange before redirecting', async () => {
    const verifyOtp = jest.fn().mockResolvedValue({
      data: { session: { user: { id: 'user-otp' } } },
      error: null,
    });
    mockCreateRouteClient.mockResolvedValue({
      auth: { verifyOtp, exchangeCodeForSession: jest.fn() },
    });

    const response = await GET(
      new NextRequest('http://evil.example/api/auth/callback?token_hash=abc&type=magiclink&next=/es/dashboard')
    );

    expect(verifyOtp).toHaveBeenCalled();
    expect(consumeOpenPinResetGrants).toHaveBeenCalledWith('user-otp');
    expect(response.headers.get('location')).toBe('http://localhost:3000/es/dashboard');
  });

  it('signs out and clears auth cookies when grant consumption fails', async () => {
    const signOut = jest.fn().mockResolvedValue({ error: null });
    const setCookie = jest.fn();
    (cookies as jest.Mock).mockResolvedValue({
      getAll: () => [{ name: 'sb-ref-auth-token', value: 'live-session' }],
      set: setCookie,
    });
    mockCreateRouteClient.mockResolvedValue({
      auth: {
        exchangeCodeForSession: jest.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
          error: null,
        }),
        verifyOtp: jest.fn(),
        signOut,
      },
    });
    (consumeOpenPinResetGrants as jest.Mock).mockResolvedValue(false);

    const response = await GET(
      new NextRequest('http://localhost/api/auth/callback?code=abc&next=/en/dashboard')
    );

    expect(response.status).toBe(307);
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(response.headers.get('location')).toBe(
      'http://localhost:3000/en/auth/login?error=auth_callback_failed'
    );
    const setCookieHeader = response.headers.get('set-cookie') ?? '';
    expect(setCookieHeader).not.toContain('security_session=');
    expect(setCookieHeader).toContain('sb-ref-auth-token=');
    expect(setCookieHeader.toLowerCase()).toContain('max-age=0');
    expect(setCookieHeader).not.toContain('live-session');
    expect(setCookie).toHaveBeenCalledWith('sb-ref-auth-token', '', expect.objectContaining({
      maxAge: 0,
      httpOnly: false,
    }));
  });

  it('does not consume grants when the exchange fails', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    clientWithExchange({ data: null, error: new Error('bad code') });

    const response = await GET(
      new NextRequest('http://localhost/api/auth/callback?code=abc&next=/en/dashboard')
    );

    expect(consumeOpenPinResetGrants).not.toHaveBeenCalled();
    expect(response.headers.get('location')).toBe(
      'http://localhost:3000/en/auth/forgot-password?error=auth_callback_failed'
    );
    consoleError.mockRestore();
  });
});
