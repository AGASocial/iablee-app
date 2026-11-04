/**
 * @jest-environment node
 */
import { jwtVerify } from 'jose';
import { verifySecuritySessionToken } from '@/lib/security';

jest.mock('jose', () => ({
  SignJWT: jest.fn(),
  jwtVerify: jest.fn(),
}));

describe('verifySecuritySessionToken', () => {
  const mockJwtVerify = jwtVerify as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('accepts a token only for the user it was issued to', async () => {
    mockJwtVerify.mockResolvedValue({ payload: { userId: 'user-a', role: 'security_pin_verified' } });

    await expect(verifySecuritySessionToken('token', 'user-a')).resolves.toBe(true);
    await expect(verifySecuritySessionToken('token', 'user-b')).resolves.toBe(false);
  });

  it('rejects a token that is missing userId, an empty user id, and invalid tokens', async () => {
    mockJwtVerify.mockResolvedValue({ payload: { role: 'security_pin_verified' } });
    await expect(verifySecuritySessionToken('token', 'user-a')).resolves.toBe(false);

    mockJwtVerify.mockResolvedValue({ payload: { userId: 'user-a' } });
    await expect(verifySecuritySessionToken('token', '')).resolves.toBe(false);

    mockJwtVerify.mockRejectedValue(new Error('bad signature'));
    await expect(verifySecuritySessionToken('not-a-jwt', 'user-a')).resolves.toBe(false);
  });
});
