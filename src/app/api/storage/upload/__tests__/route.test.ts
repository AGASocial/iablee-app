/**
 * @jest-environment node
 */
import { POST } from '../route';
import { getAuthenticatedContext } from '@/lib/auth-context';
import { canUploadFile, getSubscriptionLimits } from '@/lib/subscription/limits';

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
  getSubscriptionLimits: jest.fn(async () => ({ maxFileSizeMb: 10, maxStorageMb: 5000 })),
  canUploadFile: jest.fn(async () => ({ allowed: true })),
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

function authOk() {
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
}

describe('POST /api/storage/upload security gating', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (canUploadFile as jest.Mock).mockResolvedValue({ allowed: true });
    (getSubscriptionLimits as jest.Mock).mockResolvedValue({
      maxFileSizeMb: 10,
      maxStorageMb: 5000,
    });
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
    authOk();

    const response = await POST(new Request('http://localhost/api/storage/upload', { method: 'POST' }) as never);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Failed to process upload');
  });

  it('returns 413 storageLimitReached when total quota would be exceeded', async () => {
    authOk();
    (canUploadFile as jest.Mock).mockResolvedValue({
      allowed: false,
      reason: 'storageLimitReached',
      limit: 5000,
      current: 4990,
    });

    // Under per-file max (10 MB) so only the total-quota check fails
    const file = {
      name: 'chunk.bin',
      type: 'application/octet-stream',
      size: 5 * 1024 * 1024,
      stream: () => new ReadableStream(),
    };

    // Stub FormData via request.formData (Node File/FormData stubs are awkward in Jest)
    const request = {
      formData: async () => ({
        get: (key: string) => (key === 'file' ? file : null),
      }),
    };

    const response = await POST(request as never);
    const body = await response.json();

    expect(response.status).toBe(413);
    expect(body.error).toBe('storageLimitReached');
    expect(body.code).toBe('storageLimitReached');
    expect(canUploadFile).toHaveBeenCalled();
  });
});
