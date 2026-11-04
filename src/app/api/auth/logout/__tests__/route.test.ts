/**
 * @jest-environment node
 */
import { cookies } from 'next/headers';
import { POST } from '../route';
import { createRouteClient } from '@/lib/supabase-server';

jest.mock('@/lib/supabase-server', () => ({
  createRouteClient: jest.fn(),
}));

jest.mock('next/headers', () => ({
  cookies: jest.fn(),
}));

describe('POST /api/auth/logout', () => {
  it('clears security_session after sign-out', async () => {
    const deleteCookie = jest.fn();
    (cookies as jest.Mock).mockResolvedValue({ delete: deleteCookie });
    (createRouteClient as jest.Mock).mockResolvedValue({
      auth: {
        signOut: jest.fn().mockResolvedValue({ error: null }),
      },
    });

    const response = await POST();

    expect(response.status).toBe(200);
    expect(deleteCookie).toHaveBeenCalledWith('security_session');
  });
});
