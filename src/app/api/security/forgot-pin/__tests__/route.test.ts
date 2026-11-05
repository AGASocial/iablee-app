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
jest.mock('@/lib/beneficiary-email-copy', () => ({
  resolveEmailLocale: (locale?: string | null) => (locale === 'en' || locale === 'es' ? locale : 'es'),
}));
jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { from: jest.fn(), rpc: jest.fn() },
}));
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: (...args: unknown[]) => mockSendEmail(...args) },
  })),
}));

const mockSendEmail = jest.fn();

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
    mockSendEmail.mockResolvedValue({ error: null });
    (supabaseAdmin.rpc as jest.Mock).mockResolvedValue({ error: null });
  });

  function mockUser(lockedUntil: string | null, invalidateError: { message: string } | null = null) {
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
            eq: async () => ({ error: invalidateError }),
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
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith('consume_open_pin_reset_grants', {
      p_user_id: 'user-1',
    });
  });

  it('sends the reset email in the request locale', async () => {
    mockUser(null);

    const spanish = await POST(new Request('http://localhost/api/security/forgot-pin', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ locale: 'es' }),
    }) as never);
    expect(spanish.status).toBe(200);
    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({
      subject: 'Tu código para restablecer el PIN de seguridad',
      html: expect.stringContaining('Tu código de seguridad es'),
    }));

    mockSendEmail.mockClear();
    const english = await POST(new Request('http://localhost/api/security/forgot-pin', {
      method: 'POST',
      headers: { referer: 'http://localhost/en/dashboard' },
    }) as never);
    expect(english.status).toBe(200);
    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({
      subject: 'Your Security PIN Reset Code',
    }));
  });

  it('refuses to send a code while reset is locked', async () => {
    mockUser(new Date(Date.now() + 60_000).toISOString());

    const response = await POST(new Request('http://localhost/api/security/forgot-pin', {
      method: 'POST',
    }) as never);

    expect(response.status).toBe(423);
    expect(insert).not.toHaveBeenCalled();
  });

  it('does not insert a new code when previous codes cannot be invalidated', async () => {
    mockUser(null, { message: 'permission denied' });

    const response = await POST(new Request('http://localhost/api/security/forgot-pin', {
      method: 'POST',
    }) as never);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe('Failed to generate OTP');
    expect(insert).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('returns a fixed message when the email provider fails', async () => {
    mockUser(null);
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockSendEmail.mockResolvedValue({
      error: { message: 'Invalid API key re_secret_value', name: 'validation_error' },
    });

    const response = await POST(new Request('http://localhost/api/security/forgot-pin', {
      method: 'POST',
    }) as never);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'Failed to send email' });
    expect(JSON.stringify(body)).not.toContain('re_secret_value');
    expect(JSON.stringify(body)).not.toContain('validation_error');
    expect(spy).toHaveBeenCalledWith(
      'Error sending email:',
      expect.objectContaining({ message: 'Invalid API key re_secret_value' })
    );
    spy.mockRestore();
  });
});
