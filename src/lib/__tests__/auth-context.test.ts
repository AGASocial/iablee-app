/**
 * @jest-environment node
 */
import { getSecurityContext, getAuthenticatedContext } from '@/lib/auth-context';
import { createAuthenticatedRouteClient, checkSecuritySession } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase-admin';

jest.mock('@/lib/supabase-server', () => ({
  createAuthenticatedRouteClient: jest.fn(),
  checkSecuritySession: jest.fn(),
}));

jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { rpc: jest.fn() },
}));

describe('PIN-gated auth context', () => {
  const mockCreateAuth = createAuthenticatedRouteClient as jest.Mock;
  const mockCheckSession = checkSecuritySession as jest.Mock;
  const mockRpc = supabaseAdmin.rpc as jest.Mock;
  const userFrom = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateAuth.mockResolvedValue({
      supabase: { from: userFrom },
      user: { id: 'user-1' },
    });
  });

  function mockHasPin(data: boolean | null, error: { message: string } | null = null) {
    mockRpc.mockResolvedValue({ data, error });
  }

  it('asks the service client whether a PIN exists and does not select the hash', async () => {
    mockHasPin(true);
    mockCheckSession.mockResolvedValue(false);

    const result = await getSecurityContext();

    expect(mockCheckSession).toHaveBeenCalledWith('user-1');
    expect(mockRpc).toHaveBeenCalledWith('user_has_security_pin', { p_user_id: 'user-1' });
    expect(userFrom).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ctx.hasPin).toBe(true);
      expect(result.ctx.pinRequired).toBe(true);
    }
  });

  it('getAuthenticatedContext returns 403 when PIN required', async () => {
    mockHasPin(true);
    mockCheckSession.mockResolvedValue(false);

    const result = await getAuthenticatedContext();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(403);
    }
    expect(userFrom).not.toHaveBeenCalled();
  });

  it('getAuthenticatedContext allows access when PIN verified', async () => {
    mockHasPin(true);
    mockCheckSession.mockResolvedValue(true);

    const result = await getAuthenticatedContext();
    expect(result.ok).toBe(true);
  });

  it('returns 503 when the PIN status cannot be read', async () => {
    mockHasPin(null, { message: 'db down' });
    mockCheckSession.mockResolvedValue(false);

    const security = await getSecurityContext();
    expect(security.ok).toBe(false);
    if (!security.ok) {
      expect(security.status).toBe(503);
    }

    const gated = await getAuthenticatedContext();
    expect(gated.ok).toBe(false);
    if (!gated.ok) {
      expect(gated.status).toBe(503);
    }
  });

  it('treats a false existence check as no PIN', async () => {
    mockHasPin(false);
    mockCheckSession.mockResolvedValue(false);

    const result = await getSecurityContext();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ctx.hasPin).toBe(false);
      expect(result.ctx.pinRequired).toBe(false);
    }
  });
});
