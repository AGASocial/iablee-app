import { createHmac, randomInt } from 'crypto';
import { getSecuritySecret } from '@/lib/security-secret';

/** Uniform 6-digit code, including leading zeros. */
export function generatePinResetCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

/** HMAC so a database read cannot recover the 6-digit code by enumeration. */
export function hashPinResetCode(code: string): string {
  return createHmac('sha256', getSecuritySecret()).update(code).digest('hex');
}
