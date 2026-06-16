import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 10,
  duration: '30s',
  thresholds: {
    http_req_duration: ['p(95)<1500'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export default function () {
  const res = http.get(`${BASE_URL}/api/assets?limit=20`, {
    headers: { Cookie: __ENV.AUTH_COOKIE || '' },
  });
  check(res, {
    'assets paginated response': (r) => {
      if (r.status !== 200) return r.status === 401;
      const body = JSON.parse(r.body);
      return Array.isArray(body.data) && body.pagination !== undefined;
    },
  });
  sleep(0.5);
}
