/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';
import { GET, sanitizeNextPath } from '../route';
import { createRouteClient } from '@/lib/supabase-server';

jest.mock('@/lib/supabase-server', () => ({
  createRouteClient: jest.fn(),
}));

describe('GET /api/auth/callback', () => {
  const mockCreateRouteClient = createRouteClient as jest.Mock;

  it('clears security_session after a successful code exchange', async () => {
    mockCreateRouteClient.mockResolvedValue({
      auth: {
        exchangeCodeForSession: jest.fn().mockResolvedValue({ error: null }),
      },
    });

    const response = await GET(
      new NextRequest('http://localhost/api/auth/callback?code=abc&next=/en/dashboard')
    );

    expect(response.status).toBe(307);
    const setCookie = response.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('security_session=');
    expect(setCookie.toLowerCase()).toContain('max-age=0');
    expect(setCookie.toLowerCase()).toContain('httponly');
    expect(setCookie.toLowerCase()).toContain('path=/');
    expect(setCookie.toLowerCase()).toContain('samesite=lax');
    expect(response.headers.get('location')).toBe('http://localhost/en/dashboard');
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
    mockCreateRouteClient.mockResolvedValue({
      auth: {
        exchangeCodeForSession: jest.fn().mockResolvedValue({ error: null }),
      },
    });

    const response = await GET(
      new NextRequest('http://localhost/api/auth/callback?code=abc&next=' + encodeURIComponent('/\\evil.com'))
    );

    expect(response.headers.get('location')).toBe('http://localhost/en');
  });
});
