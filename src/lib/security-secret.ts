/** HS256 needs a 256-bit key. Shorter values are rejected at use, not at import. */
const MIN_SECRET_LENGTH = 32;

export function getSecuritySecret(): string {
  const secret = process.env.SUPABASE_JWT_SECRET?.trim() ?? '';
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error('SUPABASE_JWT_SECRET is missing or too short');
  }
  return secret;
}
