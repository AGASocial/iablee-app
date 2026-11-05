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
const MISSING_OR_SHORT =
  'APP_TOKEN_SECRET (or legacy SUPABASE_JWT_SECRET) is missing or too short';

describe('PIN reset codes', () => {
  const originalAppSecret = process.env.APP_TOKEN_SECRET;
  const originalLegacySecret = process.env.SUPABASE_JWT_SECRET;

  beforeEach(() => {
    delete process.env.SUPABASE_JWT_SECRET;
    process.env.APP_TOKEN_SECRET = SECRET;
  });

  afterEach(() => {
    if (originalAppSecret === undefined) {
      delete process.env.APP_TOKEN_SECRET;
    } else {
      process.env.APP_TOKEN_SECRET = originalAppSecret;
    }
    if (originalLegacySecret === undefined) {
      delete process.env.SUPABASE_JWT_SECRET;
    } else {
      process.env.SUPABASE_JWT_SECRET = originalLegacySecret;
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

  it('falls back to legacy SUPABASE_JWT_SECRET when APP_TOKEN_SECRET is unset', () => {
    delete process.env.APP_TOKEN_SECRET;
    process.env.SUPABASE_JWT_SECRET = SECRET;
    expect(getSecuritySecret()).toBe(SECRET);
  });

  it('throws at use when the secret is missing or short', () => {
    process.env.APP_TOKEN_SECRET = 'short';
    expect(() => getSecuritySecret()).toThrow(MISSING_OR_SHORT);
    delete process.env.APP_TOKEN_SECRET;
    expect(() => getSecuritySecret()).toThrow(MISSING_OR_SHORT);
  });
});
