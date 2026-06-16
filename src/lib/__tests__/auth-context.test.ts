/**
 * @jest-environment node
 */
import { getSecurityContext, getAuthenticatedContext } from '@/lib/auth-context';
import { createAuthenticatedRouteClient, checkSecuritySession } from '@/lib/supabase-server';

jest.mock('@/lib/supabase-server', () => ({
  createAuthenticatedRouteClient: jest.fn(),
  checkSecuritySession: jest.fn(),
}));

describe('PIN-gated auth context', () => {
  const mockCreateAuth = createAuthenticatedRouteClient as jest.Mock;
  const mockCheckSession = checkSecuritySession as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('getSecurityContext reports locked when PIN set but session invalid', async () => {
    mockCreateAuth.mockResolvedValue({
      supabase: {
        from: () => ({
          select: () => ({
            eq: () => ({
              single: () =>
                Promise.resolve({ data: { security_pin_hash: 'hash' }, error: null }),
            }),
          }),
        }),
      },
      user: { id: 'user-1' },
    });
    mockCheckSession.mockResolvedValue(false);

    const result = await getSecurityContext();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ctx.hasPin).toBe(true);
      expect(result.ctx.pinRequired).toBe(true);
    }
  });

  it('getAuthenticatedContext returns 403 when PIN required', async () => {
    mockCreateAuth.mockResolvedValue({
      supabase: {
        from: () => ({
          select: () => ({
            eq: () => ({
              single: () =>
                Promise.resolve({ data: { security_pin_hash: 'hash' }, error: null }),
            }),
          }),
        }),
      },
      user: { id: 'user-1' },
    });
    mockCheckSession.mockResolvedValue(false);

    const result = await getAuthenticatedContext();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(403);
    }
  });

  it('getAuthenticatedContext allows access when PIN verified', async () => {
    mockCreateAuth.mockResolvedValue({
      supabase: {
        from: () => ({
          select: () => ({
            eq: () => ({
              single: () =>
                Promise.resolve({ data: { security_pin_hash: 'hash' }, error: null }),
            }),
          }),
        }),
      },
      user: { id: 'user-1' },
    });
    mockCheckSession.mockResolvedValue(true);

    const result = await getAuthenticatedContext();
    expect(result.ok).toBe(true);
  });
});
