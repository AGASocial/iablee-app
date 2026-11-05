/**
 * @jest-environment node
 */
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

jest.mock('next/headers', () => ({
  cookies: jest.fn(),
}));

describe('POST /api/auth/logout', () => {
  it('clears security_session after sign-out', async () => {
    const setCookie = jest.fn();
    (cookies as jest.Mock).mockResolvedValue({ set: setCookie });
    const signOut = jest.fn().mockResolvedValue({ error: null });
    (createRouteClient as jest.Mock).mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null }),
        signOut,
      },
    });

    const response = await POST();

    expect(response.status).toBe(200);
    expect(consumeOpenPinResetGrants).toHaveBeenCalledWith('user-1');
    expect(signOut).toHaveBeenCalled();
    expect((consumeOpenPinResetGrants as jest.Mock).mock.invocationCallOrder[0])
      .toBeLessThan(signOut.mock.invocationCallOrder[0]);
    expect(setCookie).toHaveBeenCalledWith('security_session', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    });
  });
});
