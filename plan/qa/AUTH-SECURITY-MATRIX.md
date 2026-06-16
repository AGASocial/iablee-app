# Auth & Security Load Test Matrix

Baseline matrix for rate limiting and PIN lockout validation in iablee-app.

## Endpoints

| Endpoint | Method | Rate limit key | Limit | Window | Lockout |
|----------|--------|----------------|-------|--------|---------|
| `/api/auth/login` | POST | `auth:login:{ip}` | 10 | 60s | — |
| `/api/auth/register` | POST | `auth:register:{ip}` | 10 | 60s | — |
| `/api/security/verify-pin` | POST | `security:verify-pin:{ip}` + `security:verify-pin:user:{id}` | 5 | 60s | 5 failures → 15 min lock |
| `/api/security/forgot-pin` | POST | `security:forgot-pin:{ip}` + `security:forgot-pin:user:{id}` | 5 | 60s | — |
| `/api/security/check-session` | GET | — | — | — | — |
| `/api/storage/upload` | POST | `upload:{ip}` + `upload:user:{id}` | 20 | 60s | — |

## Expected behaviors

### Rate limiting (HTTP 429)

- Exceeding per-IP or per-user limits returns `{ error: "Too many requests", retryAfter }` with `Retry-After` header.
- Limits are independent per key (IP vs user vs route).

### PIN lockout (HTTP 423)

- After 5 invalid PIN attempts, `users.pin_locked_until` is set 15 minutes ahead.
- Locked users receive 423 with `lockedUntil` until expiry.
- Successful PIN verify resets `pin_failed_attempts` and clears `pin_locked_until`.

### OTP routes (admin client)

- `forgot-pin` and `verify-reset-code` use `supabaseAdmin` because RLS denies client access on `security_otps`.

## Test coverage

| Scenario | Automated | Tool |
|----------|-----------|------|
| Pagination contract | Yes | Jest (`lib/__tests__/pagination.test.ts`) |
| Rate limiter unit | Yes | Jest (`lib/__tests__/rate-limit.test.ts`) |
| PIN lockout helpers | Yes | Jest (`lib/__tests__/pin-lockout.test.ts`) |
| Subscription status | Yes | Jest (`api/subscription/status/__tests__/route.test.ts`) |
| verify-pin rate limit smoke | Manual / k6 | Expect 429 after 5 req/min per IP |
| Lockout after N failures | Partial | Route integration (DB required) |

## k6 smoke (verify-pin)

```javascript
import http from 'k6/http';
import { check } from 'k6';

export default function () {
  const res = http.post(
    `${__ENV.BASE_URL}/api/security/verify-pin`,
    JSON.stringify({ pin: '000000' }),
    { headers: { 'Content-Type': 'application/json' }, cookies: { /* session */ } }
  );
  check(res, { 'eventually 429': (r) => r.status === 429 || r.status === 401 });
}
```

Run with authenticated session cookie after exceeding 5 requests in 60s; expect 429.

## Baseline recording

| Date | Environment | verify-pin 429 at | PIN lockout at attempt | Notes |
|------|-------------|-------------------|------------------------|-------|
| 2026-06-16 | local/dev | scripts ready | scripts ready | k6 smoke scripts in plan/load-tests/; run with BASE_URL + AUTH_COOKIE |
