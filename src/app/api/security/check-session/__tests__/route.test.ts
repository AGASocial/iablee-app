/**
 * @jest-environment node
 */
import { GET } from '../route';
import { getSecurityContext } from '@/lib/auth-context';

jest.mock('@/lib/auth-context', () => ({
  getSecurityContext: jest.fn(),
}));
jest.mock('@/lib/observability', () => ({
  withTiming: (_name: string, handler: (request: Request) => Promise<Response>) => handler,
}));

describe('GET /api/security/check-session', () => {
  it('returns 503 when the PIN hash cannot be read', async () => {
    (getSecurityContext as jest.Mock).mockResolvedValue({
      ok: false,
      status: 503,
      error: 'Security status unavailable',
    });

    const response = await GET(new Request('http://localhost/api/security/check-session'));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error).toBe('Security status unavailable');
    expect(body.locked).toBeUndefined();
  });
});
