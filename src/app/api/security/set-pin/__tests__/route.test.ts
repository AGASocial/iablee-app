/**
 * @jest-environment node
 */
import { POST } from '../route';
import { createAuthenticatedRouteClient, hasPinResetSession } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { createSecuritySessionToken } from '@/lib/security';
import { cookies } from 'next/headers';

jest.mock('@/lib/supabase-server', () => ({
  createAuthenticatedRouteClient: jest.fn(),
  hasPinResetSession: jest.fn(),
}));
jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { from: jest.fn() },
}));
jest.mock('@/lib/security', () => ({
  createSecuritySessionToken: jest.fn().mockResolvedValue('verified-token'),
}));
jest.mock('next/headers', () => ({
  cookies: jest.fn().mockResolvedValue({ set: jest.fn() }),
}));
jest.mock('bcryptjs', () => ({
  genSalt: jest.fn().mockResolvedValue('salt'),
  hash: jest.fn().mockResolvedValue('hashed-pin'),
}));

describe('POST /api/security/set-pin', () => {
  const updateEq = jest.fn().mockResolvedValue({ error: null });
  const update = jest.fn().mockReturnValue({ eq: updateEq });

  beforeEach(() => {
    jest.clearAllMocks();
    updateEq.mockResolvedValue({ error: null });
    (createAuthenticatedRouteClient as jest.Mock).mockResolvedValue({
      user: { id: 'user-1' },
    });
  });

  function mockHash(hash: string | null) {
    (supabaseAdmin.from as jest.Mock).mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          single: () => Promise.resolve({ data: { security_pin_hash: hash }, error: null }),
        }),
      }),
      update,
    }));
  }

  function request(pin = '123456') {
    return new Request('http://localhost/api/security/set-pin', {
      method: 'POST',
      body: JSON.stringify({ pin }),
    });
  }

  it('writes the first PIN through the service client', async () => {
    mockHash(null);

    const response = await POST(request() as never);

    expect(response.status).toBe(200);
    expect(supabaseAdmin.from).toHaveBeenCalledWith('users');
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ security_pin_hash: 'hashed-pin' })
    );
    expect(hasPinResetSession).not.toHaveBeenCalled();
  });

  it('refuses to replace an existing PIN without a reset session', async () => {
    mockHash('existing-hash');
    (hasPinResetSession as jest.Mock).mockResolvedValue(false);

    const response = await POST(request() as never);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toMatch(/reset code/i);
    expect(update).not.toHaveBeenCalled();
  });

  it('replaces an existing PIN when a reset OTP session is present', async () => {
    mockHash('existing-hash');
    (hasPinResetSession as jest.Mock).mockResolvedValue(true);

    const response = await POST(request() as never);

    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ security_pin_hash: 'hashed-pin' })
    );
    expect(createSecuritySessionToken).toHaveBeenCalledWith('user-1', 'pin_verified');
    expect(cookies).toHaveBeenCalled();
  });
});
