/**
 * @jest-environment node
 */
import { cookies } from 'next/headers';
import { readPinResetGrantId, verifySecuritySessionToken } from '@/lib/security';
import { checkSecuritySession, hasPinResetSession, readPinResetGrant } from '@/lib/supabase-server';

jest.mock('next/headers', () => ({
  cookies: jest.fn(),
}));

jest.mock('@/lib/security', () => ({
  verifySecuritySessionToken: jest.fn(),
  readPinResetGrantId: jest.fn(),
}));

describe('checkSecuritySession', () => {
  const mockCookies = cookies as jest.Mock;
  const mockVerify = verifySecuritySessionToken as jest.Mock;
  const mockGrant = readPinResetGrantId as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('passes the cookie and the authenticated user id to the verifier', async () => {
    mockCookies.mockResolvedValue({
      get: () => ({ value: 'session-token' }),
    });
    mockVerify.mockResolvedValue(true);

    await expect(checkSecuritySession('user-a')).resolves.toBe(true);
    expect(mockVerify).toHaveBeenCalledWith('session-token', 'user-a', 'pin_verified');
  });

  it('rejects when the verifier rejects another user', async () => {
    mockCookies.mockResolvedValue({
      get: () => ({ value: 'session-token' }),
    });
    mockVerify.mockImplementation(async (_token: string, userId: string) => userId === 'user-a');

    await expect(checkSecuritySession('user-b')).resolves.toBe(false);
    expect(mockVerify).toHaveBeenCalledWith('session-token', 'user-b', 'pin_verified');
  });

  it('asks the verifier for a pin_reset session', async () => {
    mockCookies.mockResolvedValue({
      get: () => ({ value: 'session-token' }),
    });
    mockVerify.mockResolvedValue(true);

    await expect(hasPinResetSession('user-a')).resolves.toBe(true);
    expect(mockVerify).toHaveBeenCalledWith('session-token', 'user-a', 'pin_reset');
  });

  it('reads the single-use grant id from the pin_reset cookie', async () => {
    mockCookies.mockResolvedValue({
      get: () => ({ value: 'session-token' }),
    });
    mockGrant.mockResolvedValue('11111111-1111-4111-8111-111111111111');

    await expect(readPinResetGrant('user-a')).resolves.toBe('11111111-1111-4111-8111-111111111111');
    expect(mockGrant).toHaveBeenCalledWith('session-token', 'user-a');
  });

  it('rejects when the cookie is missing or the user id is empty', async () => {
    mockCookies.mockResolvedValue({ get: () => undefined });

    await expect(checkSecuritySession('user-a')).resolves.toBe(false);
    await expect(checkSecuritySession('')).resolves.toBe(false);
    expect(mockVerify).not.toHaveBeenCalled();
    expect(mockCookies).toHaveBeenCalledTimes(1);
  });
});
