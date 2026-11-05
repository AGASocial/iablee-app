import { SignJWT, jwtVerify } from 'jose';
import { getSecuritySecret } from '@/lib/security-secret';

export type SecuritySessionPurpose = 'pin_verified' | 'pin_reset';

export { getSecuritySecret };

function signingKey(): Uint8Array {
  return new TextEncoder().encode(getSecuritySecret());
}

export async function createSecuritySessionToken(
  userId: string,
  purpose: SecuritySessionPurpose = 'pin_verified'
): Promise<string> {
  return await new SignJWT({ userId, role: 'security_pin_verified', purpose })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(signingKey());
}

export async function verifySecuritySessionToken(
  token: string,
  userId: string,
  purpose?: SecuritySessionPurpose
): Promise<boolean> {
  if (!userId) return false;

  let key: Uint8Array;
  try {
    key = signingKey();
  } catch {
    return false;
  }

  try {
    const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'] });
    if (payload.role !== 'security_pin_verified') {
      return false;
    }
    if (typeof payload.userId !== 'string' || payload.userId !== userId) {
      return false;
    }
    const tokenPurpose =
      payload.purpose === 'pin_reset' || payload.purpose === 'pin_verified'
        ? payload.purpose
        : 'pin_verified';
    const expected = purpose ?? 'pin_verified';
    if (tokenPurpose !== expected) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
