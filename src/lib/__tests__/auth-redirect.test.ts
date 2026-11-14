/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';
import { POST as startOAuth } from '@/app/api/auth/oauth/start/route';
import { POST as register } from '@/app/api/auth/register/route';
import { POST as forgotPassword } from '@/app/api/auth/forgot-password/route';
import { getAuthRedirectOrigin, resolveAuthLocale } from '@/lib/app-url';
import { resetRateLimitStore } from '@/lib/rate-limit';
import { createRouteClient } from '@/lib/supabase-server';

jest.mock('@/lib/supabase-server', () => ({
  createRouteClient: jest.fn(),
}));

const ORIGINAL_ENV = {
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  VERCEL_URL: process.env.VERCEL_URL,
};

const HOST_HEADERS = {
  origin: 'https://evil.example',
  'x-forwarded-host': 'evil.example',
  'x-forwarded-proto': 'http',
  host: 'evil.example',
};

function restoreEnv() {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe('auth redirect origin', () => {
  const signInWithOAuth = jest.fn();
  const signUp = jest.fn();
  const resetPasswordForEmail = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    resetRateLimitStore();
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.VERCEL_URL;
    process.env.NEXT_PUBLIC_SITE_URL = 'https://app.iablee.test/ignored-path';
    signInWithOAuth.mockResolvedValue({ data: { url: 'https://accounts.google.com/o/oauth2' }, error: null });
    signUp.mockResolvedValue({ error: null });
    resetPasswordForEmail.mockResolvedValue({ error: null });
    (createRouteClient as jest.Mock).mockResolvedValue({
      auth: { signInWithOAuth, signUp, resetPasswordForEmail },
    });
  });

  afterAll(() => {
    restoreEnv();
  });

  it('uses NEXT_PUBLIC_SITE_URL and only en or es', () => {
    expect(getAuthRedirectOrigin()).toBe('https://app.iablee.test');
    expect(resolveAuthLocale('es')).toBe('es');
    expect(resolveAuthLocale('en')).toBe('en');
    expect(resolveAuthLocale('es/../../admin')).toBe('en');
    expect(resolveAuthLocale('https://evil.example')).toBe('en');
    expect(resolveAuthLocale(undefined)).toBe('en');
  });

  it('falls back to getAppUrl when the site URL is unset', () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    process.env.NEXT_PUBLIC_APP_URL = 'https://preview.example/app';
    expect(getAuthRedirectOrigin()).toBe('https://preview.example');
  });

  it('starts OAuth against the fixed origin', async () => {
    const response = await startOAuth(new NextRequest('http://evil.example/api/auth/oauth/start', {
      method: 'POST',
      headers: { ...HOST_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'google', locale: 'es' }),
    }));

    expect(response.status).toBe(200);
    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: {
        redirectTo: 'https://app.iablee.test/api/auth/callback?next=%2Fes',
      },
    });
  });

  it('rejects a locale outside en and es on signup', async () => {
    const response = await register(new NextRequest('http://evil.example/api/auth/register', {
      method: 'POST',
      headers: { ...HOST_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'a@example.com',
        password: 'Password123!',
        locale: 'https://evil.example',
      }),
    }));

    expect(response.status).toBe(200);
    expect(signUp).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({
        emailRedirectTo: 'https://app.iablee.test/api/auth/callback?next=%2Fen',
      }),
    }));
  });

  it('builds the recovery redirect from the fixed origin', async () => {
    const response = await forgotPassword(new NextRequest('http://evil.example/api/auth/forgot-password', {
      method: 'POST',
      headers: { ...HOST_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@example.com', locale: 'es/../en' }),
    }));

    expect(response.status).toBe(200);
    expect(resetPasswordForEmail).toHaveBeenCalledWith('a@example.com', {
      redirectTo: 'https://app.iablee.test/api/auth/callback?next=%2Fen%2Fauth%2Freset-password',
    });
    const setCookie = response.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('auth_callback_next');
    expect(decodeURIComponent(setCookie)).toContain('/en/auth/reset-password');
    expect(setCookie).not.toContain('evil.example');
  });
});
