/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';
import { GET } from '../route';
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
  });
});
