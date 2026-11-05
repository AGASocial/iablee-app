/**
 * @jest-environment node
 */
import * as crypto from 'crypto';
import { POST } from '../route';

jest.mock('crypto', () => {
  const actual = jest.requireActual<typeof import('crypto')>('crypto');
  return {
    ...actual,
    randomInt: jest.fn(() => 42),
  };
});
import { createAuthenticatedRouteClient } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { resetRateLimitStore } from '@/lib/rate-limit';

jest.mock('@/lib/supabase-server', () => ({
  createAuthenticatedRouteClient: jest.fn(),
}));
jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { from: jest.fn() },
}));
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: jest.fn().mockResolvedValue({ error: null }) },
  })),
}));

const SECRET = 'test-secret-that-is-long-enough-32';

describe('POST /api/security/forgot-pin', () => {
  const insert = jest.fn().mockResolvedValue({ error: null });

  beforeEach(() => {
    jest.clearAllMocks();
    resetRateLimitStore();
    process.env.SUPABASE_JWT_SECRET = SECRET;
    (createAuthenticatedRouteClient as jest.Mock).mockResolvedValue({
      user: { id: 'user-1', email: 'owner@example.com' },
    });
    insert.mockResolvedValue({ error: null });
  });

  function mockUser(lockedUntil: string | null) {
    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'users') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: { pin_reset_locked_until: lockedUntil },
                error: null,
              }),
            }),
          }),
        };
      }
      return {
        update: () => ({
          eq: () => ({
            eq: async () => ({ error: null }),
          }),
        }),
        insert,
      };
    });
  }

  it('stores only the HMAC of the reset code', async () => {
    mockUser(null);

    const response = await POST(new Request('http://localhost/api/security/forgot-pin', {
      method: 'POST',
    }) as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    const expected = crypto.createHmac('sha256', SECRET).update('000042').digest('hex');
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        code: expected,
        verified: false,
      })
    );
    expect(insert.mock.calls[0][0].code).not.toBe('000042');
  });

  it('refuses to send a code while reset is locked', async () => {
    mockUser(new Date(Date.now() + 60_000).toISOString());

    const response = await POST(new Request('http://localhost/api/security/forgot-pin', {
      method: 'POST',
    }) as never);

    expect(response.status).toBe(423);
    expect(insert).not.toHaveBeenCalled();
  });
});
