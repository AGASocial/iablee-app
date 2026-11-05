/**
 * @jest-environment node
 */
import { cookies } from 'next/headers';
import { readSecuritySession } from '@/lib/security';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { checkSecuritySession, hasPinResetSession, readPinResetGrant } from '@/lib/supabase-server';

jest.mock('next/headers', () => ({
  cookies: jest.fn(),
}));

jest.mock('@/lib/security', () => ({
  readSecuritySession: jest.fn(),
}));

jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { from: jest.fn() },
}));

const GRANT_ID = '11111111-1111-4111-8111-111111111111';

describe('checkSecuritySession', () => {
  const mockCookies = cookies as jest.Mock;
  const mockRead = readSecuritySession as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function mockPinVersion(version: number | null) {
    (supabaseAdmin.from as jest.Mock).mockReturnValue({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: version === null ? null : { security_pin_version: version },
            error: null,
          }),
        }),
      }),
    });
  }

  it('accepts a pin_verified cookie whose PIN version matches the user', async () => {
    mockCookies.mockResolvedValue({
      get: () => ({ value: 'session-token' }),
    });
    mockRead.mockResolvedValue({ purpose: 'pin_verified', jti: null, pinVersion: 3 });
    mockPinVersion(3);

    await expect(checkSecuritySession('user-a')).resolves.toBe(true);
    expect(mockRead).toHaveBeenCalledWith('session-token', 'user-a', 'pin_verified');
    expect(supabaseAdmin.from).toHaveBeenCalledWith('users');
  });

  it('rejects a cookie minted for another user', async () => {
    mockCookies.mockResolvedValue({
      get: () => ({ value: 'session-token' }),
    });
    mockRead.mockImplementation(async (_token: string, userId: string) => (
      userId === 'user-a'
        ? { purpose: 'pin_verified', jti: null, pinVersion: 1 }
        : null
    ));
    mockPinVersion(1);

    await expect(checkSecuritySession('user-b')).resolves.toBe(false);
    expect(mockRead).toHaveBeenCalledWith('session-token', 'user-b', 'pin_verified');
  });

  it('rejects a cookie when the PIN version changed', async () => {
    mockCookies.mockResolvedValue({
      get: () => ({ value: 'session-token' }),
    });
    mockRead.mockResolvedValue({ purpose: 'pin_verified', jti: null, pinVersion: 1 });
    mockPinVersion(2);

    await expect(checkSecuritySession('user-a')).resolves.toBe(false);
  });

  it('rejects a cookie that has no PIN version', async () => {
    mockCookies.mockResolvedValue({
      get: () => ({ value: 'session-token' }),
    });
    mockRead.mockResolvedValue({ purpose: 'pin_verified', jti: null, pinVersion: null });

    await expect(checkSecuritySession('user-a')).resolves.toBe(false);
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });

  it('asks for a pin_reset session with the same version check', async () => {
    mockCookies.mockResolvedValue({
      get: () => ({ value: 'session-token' }),
    });
    mockRead.mockResolvedValue({ purpose: 'pin_reset', jti: GRANT_ID, pinVersion: 4 });
    mockPinVersion(4);

    await expect(hasPinResetSession('user-a')).resolves.toBe(true);
    expect(mockRead).toHaveBeenCalledWith('session-token', 'user-a', 'pin_reset');
  });

  it('reads the grant id only when the PIN version still matches', async () => {
    mockCookies.mockResolvedValue({
      get: () => ({ value: 'session-token' }),
    });
    mockRead.mockResolvedValue({ purpose: 'pin_reset', jti: GRANT_ID, pinVersion: 4 });
    mockPinVersion(4);

    await expect(readPinResetGrant('user-a')).resolves.toBe(GRANT_ID);

    mockPinVersion(5);
    await expect(readPinResetGrant('user-a')).resolves.toBeNull();
  });

  it('rejects when the cookie is missing or the user id is empty', async () => {
    mockCookies.mockResolvedValue({ get: () => undefined });

    await expect(checkSecuritySession('user-a')).resolves.toBe(false);
    await expect(checkSecuritySession('')).resolves.toBe(false);
    expect(mockRead).not.toHaveBeenCalled();
    expect(mockCookies).toHaveBeenCalledTimes(1);
  });
});
