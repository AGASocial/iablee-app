import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 20,
  duration: '30s',
  thresholds: {
    http_req_duration: ['p(95)<1000'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export default function () {
  const loginRes = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ email: __ENV.TEST_EMAIL || 'test@example.com', password: __ENV.TEST_PASSWORD || 'password' }),
    { headers: { 'Content-Type': 'application/json' } }
  );

  check(loginRes, {
    'login responds': (r) => r.status === 200 || r.status === 401 || r.status === 429,
  });

  const sessionRes = http.get(`${BASE_URL}/api/security/check-session`, {
    headers: { Cookie: loginRes.headers['Set-Cookie'] || __ENV.AUTH_COOKIE || '' },
  });

  check(sessionRes, {
    'check-session responds': (r) => r.status === 200,
  });

  sleep(0.2);
}
