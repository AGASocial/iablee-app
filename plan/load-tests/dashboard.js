import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 5,
  duration: '30s',
  thresholds: {
    http_req_duration: ['p(95)<2000'],
    http_req_failed: ['rate<0.1'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export default function () {
  const res = http.get(`${BASE_URL}/api/dashboard`, {
    headers: { Cookie: __ENV.AUTH_COOKIE || '' },
  });
  check(res, {
    'dashboard status 200 or 401': (r) => r.status === 200 || r.status === 401,
  });
  sleep(1);
}
