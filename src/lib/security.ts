import { SignJWT, jwtVerify } from 'jose';

const SECRET_KEY = process.env.SUPABASE_JWT_SECRET || 'fallback-secret-development-only-do-not-use-in-prod';
const key = new TextEncoder().encode(SECRET_KEY);

export async function createSecuritySessionToken(userId: string): Promise<string> {
    return await new SignJWT({ userId, role: 'security_pin_verified' })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('15m')
        .sign(key);
}

export async function verifySecuritySessionToken(token: string): Promise<boolean> {
    try {
        await jwtVerify(token, key);
        return true;
    } catch {
        return false;
    }
}
