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
  const originalSecret = process.env.SUPABASE_JWT_SECRET;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SUPABASE_JWT_SECRET = 'test-secret-that-is-long-enough-32';
  });

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.SUPABASE_JWT_SECRET;
    } else {
      process.env.SUPABASE_JWT_SECRET = originalSecret;
    }
  });

  it('accepts a token only for the user it was issued to', async () => {
    mockJwtVerify.mockResolvedValue({ payload: { userId: 'user-a', role: 'security_pin_verified' } });

    await expect(verifySecuritySessionToken('token', 'user-a')).resolves.toBe(true);
    await expect(verifySecuritySessionToken('token', 'user-b')).resolves.toBe(false);
    expect(mockJwtVerify).toHaveBeenCalledWith(
      'token',
      expect.any(Uint8Array),
      { algorithms: ['HS256'] }
    );
  });

  it('accepts a reset token only when that purpose is required', async () => {
    mockJwtVerify.mockResolvedValue({
      payload: {
        userId: 'user-a',
        role: 'security_pin_verified',
        purpose: 'pin_reset',
      },
    });

    await expect(verifySecuritySessionToken('token', 'user-a', 'pin_reset')).resolves.toBe(true);
    await expect(verifySecuritySessionToken('token', 'user-a', 'pin_verified')).resolves.toBe(false);
    await expect(verifySecuritySessionToken('token', 'user-a')).resolves.toBe(false);
  });

  it('rejects a token that is not a security PIN session', async () => {
    mockJwtVerify.mockResolvedValue({
      payload: { userId: 'user-a', role: 'authenticated', purpose: 'pin_verified' },
    });

    await expect(verifySecuritySessionToken('token', 'user-a')).resolves.toBe(false);
  });

  it('fails closed when the signing secret is missing or short', async () => {
    process.env.SUPABASE_JWT_SECRET = 'short';
    await expect(verifySecuritySessionToken('token', 'user-a')).resolves.toBe(false);

    delete process.env.SUPABASE_JWT_SECRET;
    await expect(verifySecuritySessionToken('token', 'user-a')).resolves.toBe(false);
    expect(mockJwtVerify).not.toHaveBeenCalled();
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
