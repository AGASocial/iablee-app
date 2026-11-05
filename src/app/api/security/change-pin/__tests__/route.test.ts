/**
 * @jest-environment node
 */
import { POST } from '../route';
import { createAuthenticatedRouteClient } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase-admin';

jest.mock('@/lib/supabase-server', () => ({
  createAuthenticatedRouteClient: jest.fn(),
}));
jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { from: jest.fn() },
}));
jest.mock('bcryptjs', () => ({
  genSalt: jest.fn().mockResolvedValue('salt'),
  hash: jest.fn().mockResolvedValue('hashed-pin'),
  compare: jest.fn().mockResolvedValue(true),
}));

describe('POST /api/security/change-pin', () => {
  it('writes the new hash through the service client after the current PIN matches', async () => {
    const update = jest.fn().mockReturnValue({
      eq: jest.fn().mockResolvedValue({ error: null }),
    });
    (createAuthenticatedRouteClient as jest.Mock).mockResolvedValue({
      user: { id: 'user-1' },
      supabase: { from: jest.fn() },
    });
    (supabaseAdmin.from as jest.Mock).mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: { security_pin_hash: 'current-hash' },
            error: null,
          }),
        }),
      }),
      update,
    }));

    const response = await POST(new Request('http://localhost/api/security/change-pin', {
      method: 'POST',
      body: JSON.stringify({ currentPin: '111111', newPin: '222222' }),
    }) as never);

    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ security_pin_hash: 'hashed-pin' })
    );
    const { supabase } = await (createAuthenticatedRouteClient as jest.Mock).mock.results[0].value;
    expect(supabase.from).not.toHaveBeenCalled();
  });
});
