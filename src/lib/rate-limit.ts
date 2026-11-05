/**
 * In-memory rate limiter for dev/single-instance deployments.
 * For production multi-instance, swap to Upstash Redis or Vercel KV.
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

export interface RateLimitConfig {
  /** Max requests allowed in the window */
  limit: number;
  /** Window duration in seconds */
  windowSec: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export function checkRateLimit(
  key: string,
  config: RateLimitConfig
): RateLimitResult {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now >= entry.resetAt) {
    const resetAt = now + config.windowSec * 1000;
    store.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: config.limit - 1, resetAt };
  }

  if (entry.count >= config.limit) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  entry.count += 1;
  return { allowed: true, remaining: config.limit - entry.count, resetAt: entry.resetAt };
}

/**
 * IP used for in-memory rate limits.
 * Prefer Vercel's trusted `x-real-ip`. When only `X-Forwarded-For` is present,
 * use the last (rightmost) hop — the platform appends that peer address.
 * The first value is client-supplied and must not select the bucket.
 */
export function getClientIp(request: Request): string {
  const realIp = request.headers.get('x-real-ip')?.trim();
  if (realIp) return realIp;

  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const hops = forwarded.split(',').map((hop) => hop.trim()).filter(Boolean);
    const platformHop = hops[hops.length - 1];
    if (platformHop) return platformHop;
  }

  return 'unknown';
}

export function rateLimitResponse(resetAt: number): Response {
  const retryAfter = Math.ceil((resetAt - Date.now()) / 1000);
  return Response.json(
    { error: 'Too many requests', retryAfter },
    {
      status: 429,
      headers: { 'Retry-After': String(retryAfter) },
    }
  );
}

/**
 * verify-pin and change-pin share these keys so a stolen account session
 * cannot switch endpoints for a fresh in-memory window. The database
 * lockout counters are the authoritative control across instances.
 */
export function takeSecurityPinIpLimit(request: Request): Response | null {
  const result = checkRateLimit(
    `security:verify-pin:${getClientIp(request)}`,
    RATE_LIMITS.securityPin
  );
  if (!result.allowed) return rateLimitResponse(result.resetAt);
  return null;
}

export function takeSecurityPinUserLimit(userId: string): Response | null {
  const result = checkRateLimit(
    `security:verify-pin:user:${userId}`,
    RATE_LIMITS.securityPin
  );
  if (!result.allowed) return rateLimitResponse(result.resetAt);
  return null;
}

/** Pre-configured limits for auth/security routes */
export const RATE_LIMITS = {
  auth: { limit: 10, windowSec: 60 } as RateLimitConfig,
  securityPin: { limit: 5, windowSec: 60 } as RateLimitConfig,
  upload: { limit: 20, windowSec: 60 } as RateLimitConfig,
  beneficiaryEmail: { limit: 5, windowSec: 300 } as RateLimitConfig,
} as const;

/** Reset store between tests */
export function resetRateLimitStore(): void {
  store.clear();
}
