/**
 * @jest-environment node
 */
import * as crypto from 'crypto';
import { generatePinResetCode, hashPinResetCode } from '@/lib/pin-reset-otp';
import { getSecuritySecret } from '@/lib/security-secret';

jest.mock('crypto', () => {
  const actual = jest.requireActual<typeof import('crypto')>('crypto');
  return {
    ...actual,
    randomInt: jest.fn(() => 42),
  };
});

const SECRET = 'test-secret-that-is-long-enough-32';

describe('PIN reset codes', () => {
  const originalSecret = process.env.SUPABASE_JWT_SECRET;

  beforeEach(() => {
    process.env.SUPABASE_JWT_SECRET = SECRET;
  });

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.SUPABASE_JWT_SECRET;
    } else {
      process.env.SUPABASE_JWT_SECRET = originalSecret;
    }
  });

  it('generates a zero-padded code with crypto.randomInt', () => {
    expect(generatePinResetCode()).toBe('000042');
    expect(crypto.randomInt).toHaveBeenCalledWith(0, 1_000_000);
  });

  it('stores an HMAC and not the code itself', () => {
    const hash = hashPinResetCode('000042');
    expect(hash).toBe(crypto.createHmac('sha256', SECRET).update('000042').digest('hex'));
    expect(hash).not.toBe('000042');
    expect(hash).toHaveLength(64);
  });

  it('throws at use when the secret is missing or short', () => {
    process.env.SUPABASE_JWT_SECRET = 'short';
    expect(() => getSecuritySecret()).toThrow('SUPABASE_JWT_SECRET is missing or too short');
    delete process.env.SUPABASE_JWT_SECRET;
    expect(() => getSecuritySecret()).toThrow('SUPABASE_JWT_SECRET is missing or too short');
  });
});
