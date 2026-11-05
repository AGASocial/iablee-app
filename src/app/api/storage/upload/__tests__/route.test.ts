/**
 * @jest-environment node
 */
import { POST } from '../route';
import { getAuthenticatedContext } from '@/lib/auth-context';

jest.mock('@/lib/auth-context', () => ({
  getAuthenticatedContext: jest.fn(),
}));

jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: jest.fn(),
    storage: {
      from: jest.fn(() => ({
        upload: jest.fn(),
      })),
    },
  },
}));

jest.mock('@/lib/subscription/limits', () => ({
  getSubscriptionLimits: jest.fn(async () => ({ maxFileSizeMb: 10 })),
}));

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(() => ({ allowed: true })),
  getClientIp: jest.fn(() => '127.0.0.1'),
  rateLimitResponse: jest.fn(() => new Response(null, { status: 429 })),
  RATE_LIMITS: { upload: {} },
}));

jest.mock('@/lib/encryption', () => ({
  encryptUserKey: jest.fn(),
  generateUserKey: jest.fn(),
  decryptUserKey: jest.fn(),
  createEncryptionStream: jest.fn(),
}));

describe('POST /api/storage/upload security gating', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 403 when the user has no configured PIN', async () => {
    (getAuthenticatedContext as jest.Mock).mockResolvedValue({
      ok: true,
      ctx: {
        user: { id: 'user-1' },
        hasPin: false,
        hasSecuritySession: false,
        pinRequired: false,
        supabase: {},
      },
    });

    const response = await POST(new Request('http://localhost/api/storage/upload', { method: 'POST' }) as never);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe('Security PIN required');
  });

  it('returns 403 when the security session is locked', async () => {
    (getAuthenticatedContext as jest.Mock).mockResolvedValue({
      ok: true,
      ctx: {
        user: { id: 'user-1' },
        hasPin: true,
        hasSecuritySession: false,
        pinRequired: true,
        supabase: {},
      },
    });

    const response = await POST(new Request('http://localhost/api/storage/upload', { method: 'POST' }) as never);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe('Security PIN required');
  });

  it('passes the security gate when PIN is configured and unlocked', async () => {
    (getAuthenticatedContext as jest.Mock).mockResolvedValue({
      ok: true,
      ctx: {
        user: { id: 'user-1' },
        hasPin: true,
        hasSecuritySession: true,
        pinRequired: false,
        supabase: {},
      },
    });

    const response = await POST(new Request('http://localhost/api/storage/upload', { method: 'POST' }) as never);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Failed to process upload');
  });
});
