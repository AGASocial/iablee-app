import { SignJWT, jwtVerify } from 'jose';
import { getSecuritySecret } from '@/lib/security-secret';

export type SecuritySessionPurpose = 'pin_verified' | 'pin_reset';

export { getSecuritySecret };

function signingKey(): Uint8Array {
  return new TextEncoder().encode(getSecuritySecret());
}

const RESET_GRANT_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface SecuritySessionOptions {
  jti?: string;
  pinVersion: number;
}

export async function createSecuritySessionToken(
  userId: string,
  purpose: SecuritySessionPurpose = 'pin_verified',
  options?: SecuritySessionOptions
): Promise<string> {
  if (!options || !Number.isInteger(options.pinVersion) || options.pinVersion < 0) {
    throw new Error('Security session requires a PIN version');
  }

  const builder = new SignJWT({
    userId,
    role: 'security_pin_verified',
    purpose,
    pinVersion: options.pinVersion,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('15m');

  if (options.jti) {
    builder.setJti(options.jti);
  }

  return await builder.sign(signingKey());
}

export interface SecuritySessionSnapshot {
  purpose: SecuritySessionPurpose;
  jti: string | null;
  pinVersion: number | null;
}

function parsePinVersion(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    return value;
  }
  return null;
}

export async function readSecuritySession(
  token: string,
  userId: string,
  purpose?: SecuritySessionPurpose
): Promise<SecuritySessionSnapshot | null> {
  if (!userId) return null;

  let key: Uint8Array;
  try {
    key = signingKey();
  } catch {
    return null;
  }

  try {
    const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'] });
    if (payload.role !== 'security_pin_verified') {
      return null;
    }
    if (typeof payload.userId !== 'string' || payload.userId !== userId) {
      return null;
    }
    const tokenPurpose =
      payload.purpose === 'pin_reset' || payload.purpose === 'pin_verified'
        ? payload.purpose
        : 'pin_verified';
    const expected = purpose ?? 'pin_verified';
    if (tokenPurpose !== expected) {
      return null;
    }
    const jti = typeof payload.jti === 'string' && RESET_GRANT_ID.test(payload.jti)
      ? payload.jti
      : null;
    return { purpose: tokenPurpose, jti, pinVersion: parsePinVersion(payload.pinVersion) };
  } catch {
    return null;
  }
}

export async function verifySecuritySessionToken(
  token: string,
  userId: string,
  purpose?: SecuritySessionPurpose
): Promise<boolean> {
  return (await readSecuritySession(token, userId, purpose)) !== null;
}

/** Single-use id carried by a pin_reset cookie. Absent on verify-pin sessions. */
export async function readPinResetGrantId(
  token: string,
  userId: string
): Promise<string | null> {
  const claims = await readSecuritySession(token, userId, 'pin_reset');
  return claims?.jti ?? null;
}
