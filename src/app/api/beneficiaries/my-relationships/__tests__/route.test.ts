/**
 * @jest-environment node
 */
import { GET } from '../route';
import { getAuthenticatedContext } from '@/lib/auth-context';
import { supabaseAdmin } from '@/lib/supabase-admin';

jest.mock('@/lib/auth-context', () => ({
  getAuthenticatedContext: jest.fn(),
}));
jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    rpc: jest.fn(),
  },
}));
jest.mock('@/lib/observability', () => ({
  withTiming: (_name: string, handler: (...args: unknown[]) => unknown) => handler,
}));

describe('GET /api/beneficiaries/my-relationships', () => {
  const mockGetAuthenticatedContext = getAuthenticatedContext as jest.Mock;
  const mockRpc = supabaseAdmin.rpc as jest.Mock;
  const request = new Request('http://localhost/api/beneficiaries/my-relationships');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetAuthenticatedContext.mockResolvedValue({
      ok: false,
      status: 401,
      error: 'Unauthorized',
    });

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('returns 403 when PIN is required', async () => {
    mockGetAuthenticatedContext.mockResolvedValue({
      ok: false,
      status: 403,
      error: 'Security PIN required',
    });

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe('Security PIN required');
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('returns 403 when the user has no PIN', async () => {
    mockGetAuthenticatedContext.mockResolvedValue({
      ok: true,
      ctx: {
        user: { id: 'user-1', email: 'user@example.com' },
        supabase: {},
        hasSecuritySession: false,
        hasPin: false,
        pinRequired: false,
      },
    });

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe('Security PIN required');
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('returns 403 when the security session is missing', async () => {
    mockGetAuthenticatedContext.mockResolvedValue({
      ok: true,
      ctx: {
        user: { id: 'user-1', email: 'user@example.com' },
        supabase: {},
        hasSecuritySession: false,
        hasPin: true,
        pinRequired: false,
      },
    });

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe('Security PIN required');
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('returns 403 when a session exists but no PIN is set', async () => {
    mockGetAuthenticatedContext.mockResolvedValue({
      ok: true,
      ctx: {
        user: { id: 'user-1', email: 'user@example.com' },
        supabase: {},
        hasSecuritySession: true,
        hasPin: false,
        pinRequired: false,
      },
    });

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe('Security PIN required');
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('returns 400 when session user has no email', async () => {
    mockGetAuthenticatedContext.mockResolvedValue({
      ok: true,
      ctx: {
        user: { id: 'user-1', email: undefined },
        supabase: {},
        hasSecuritySession: true,
        hasPin: true,
        pinRequired: false,
      },
    });

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('User email not available');
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('calls service-role RPC with session email and returns relationships', async () => {
    const relationships = [
      {
        holder_full_name: 'Ada Lovelace',
        relationship_key: 'spouse',
        beneficiary_id: 'ben-1',
        email_verified_at: '2026-01-01T00:00:00Z',
        created_at: '2026-01-01T00:00:00Z',
      },
    ];

    mockGetAuthenticatedContext.mockResolvedValue({
      ok: true,
      ctx: {
        user: { id: 'user-1', email: 'Beneficiary@Example.COM' },
        supabase: {},
        hasSecuritySession: true,
        hasPin: true,
        pinRequired: false,
      },
    });
    mockRpc.mockResolvedValue({ data: relationships, error: null });

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith('get_my_beneficiary_relationships', {
      p_email: 'Beneficiary@Example.COM',
    });
    expect(body.relationships).toEqual(relationships);
  });

  it('returns 500 without leaking RPC error details', async () => {
    mockGetAuthenticatedContext.mockResolvedValue({
      ok: true,
      ctx: {
        user: { id: 'user-1', email: 'user@example.com' },
        supabase: {},
        hasSecuritySession: true,
        hasPin: true,
        pinRequired: false,
      },
    });
    mockRpc.mockResolvedValue({
      data: null,
      error: {
        message: 'internal details',
        code: 'XX000',
        details: 'secret row',
        hint: 'drop table',
      },
    });

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe('Failed to fetch beneficiary relationships');
    expect(body.error).not.toContain('internal details');
    expect(consoleSpy).toHaveBeenCalledWith('Error fetching beneficiary relationships', {
      message: 'internal details',
      code: 'XX000',
    });
    expect(JSON.stringify(consoleSpy.mock.calls)).not.toContain('secret row');
    expect(JSON.stringify(consoleSpy.mock.calls)).not.toContain('drop table');

    consoleSpy.mockRestore();
  });
});
