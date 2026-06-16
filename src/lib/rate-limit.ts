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

/** Extract client IP from request headers (Vercel/proxy-aware) */
export function getClientIp(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  );
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

/** Pre-configured limits for auth/security routes */
export const RATE_LIMITS = {
  auth: { limit: 10, windowSec: 60 } as RateLimitConfig,
  securityPin: { limit: 5, windowSec: 60 } as RateLimitConfig,
  upload: { limit: 20, windowSec: 60 } as RateLimitConfig,
} as const;

/** Reset store between tests */
export function resetRateLimitStore(): void {
  store.clear();
}
