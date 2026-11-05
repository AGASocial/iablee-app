/** HS256 needs a 256-bit key. Shorter values are rejected at use, not at import. */
const MIN_SECRET_LENGTH = 32;

/** App HS256/HMAC secret for security_session JWTs and PIN-reset OTP — not Supabase Auth JWT secret. */
export function getSecuritySecret(): string {
  const appSecret = process.env.APP_TOKEN_SECRET?.trim();
  const secret = (appSecret ? appSecret : process.env.SUPABASE_JWT_SECRET?.trim()) ?? '';
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error('APP_TOKEN_SECRET (or legacy SUPABASE_JWT_SECRET) is missing or too short');
  }
  return secret;
}
