/**
 * @jest-environment node
 */
import { cookies } from 'next/headers';
import { verifySecuritySessionToken } from '@/lib/security';
import { checkSecuritySession } from '@/lib/supabase-server';

jest.mock('next/headers', () => ({
  cookies: jest.fn(),
}));

jest.mock('@/lib/security', () => ({
  verifySecuritySessionToken: jest.fn(),
}));

describe('checkSecuritySession', () => {
  const mockCookies = cookies as jest.Mock;
  const mockVerify = verifySecuritySessionToken as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('passes the cookie and the authenticated user id to the verifier', async () => {
    mockCookies.mockResolvedValue({
      get: () => ({ value: 'session-token' }),
    });
    mockVerify.mockResolvedValue(true);

    await expect(checkSecuritySession('user-a')).resolves.toBe(true);
    expect(mockVerify).toHaveBeenCalledWith('session-token', 'user-a');
  });

  it('rejects when the verifier rejects another user', async () => {
    mockCookies.mockResolvedValue({
      get: () => ({ value: 'session-token' }),
    });
    mockVerify.mockImplementation(async (_token: string, userId: string) => userId === 'user-a');

    await expect(checkSecuritySession('user-b')).resolves.toBe(false);
    expect(mockVerify).toHaveBeenCalledWith('session-token', 'user-b');
  });

  it('rejects when the cookie is missing or the user id is empty', async () => {
    mockCookies.mockResolvedValue({ get: () => undefined });

    await expect(checkSecuritySession('user-a')).resolves.toBe(false);
    await expect(checkSecuritySession('')).resolves.toBe(false);
    expect(mockVerify).not.toHaveBeenCalled();
    expect(mockCookies).toHaveBeenCalledTimes(1);
  });
});
