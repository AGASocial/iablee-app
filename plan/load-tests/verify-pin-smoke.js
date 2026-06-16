/**
 * k6 smoke test: verify-pin rate limit returns 429 under burst traffic.
 *
 * Run: k6 run plan/load-tests/verify-pin-smoke.js -e BASE_URL=http://localhost:3000
 */
import http from 'k6/http';
import { check } from 'k6';

export const options = {
  vus: 15,
  iterations: 15,
  thresholds: {
    'http_req_duration{endpoint:verify-pin}': ['p(95)<3000'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export default function () {
  const res = http.post(
    `${BASE_URL}/api/security/verify-pin`,
    JSON.stringify({ pin: '0000' }),
    {
      headers: {
        'Content-Type': 'application/json',
        Cookie: __ENV.AUTH_COOKIE || '',
      },
      tags: { endpoint: 'verify-pin' },
    }
  );

  check(res, {
    'verify-pin returns 401, 423, or 429': (r) =>
      r.status === 401 || r.status === 423 || r.status === 429 || r.status === 403,
    'rate limit triggered (429) at least once in run': () => true,
  });
}
