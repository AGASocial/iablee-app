/**
 * @jest-environment node
 */
import { POST } from '../route';
import { createAuthenticatedRouteClient, readPinResetGrant } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { createSecuritySessionToken } from '@/lib/security';
import { cookies } from 'next/headers';

jest.mock('@/lib/supabase-server', () => ({
  createAuthenticatedRouteClient: jest.fn(),
  readPinResetGrant: jest.fn(),
}));
jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { from: jest.fn(), rpc: jest.fn() },
}));
jest.mock('@/lib/security', () => ({
  createSecuritySessionToken: jest.fn().mockResolvedValue('verified-token'),
}));
jest.mock('next/headers', () => ({
  cookies: jest.fn().mockResolvedValue({ set: jest.fn() }),
}));
jest.mock('bcryptjs', () => ({
  genSalt: jest.fn().mockResolvedValue('salt'),
  hash: jest.fn().mockResolvedValue('hashed-pin'),
}));

const GRANT_ID = '11111111-1111-4111-8111-111111111111';

describe('POST /api/security/set-pin', () => {
  const updateEq = jest.fn().mockResolvedValue({ error: null });
  const update = jest.fn().mockReturnValue({ eq: updateEq });
  const rpc = supabaseAdmin.rpc as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    updateEq.mockResolvedValue({ error: null });
    (createAuthenticatedRouteClient as jest.Mock).mockResolvedValue({
      user: { id: 'user-1' },
    });
    (supabaseAdmin.from as jest.Mock).mockImplementation(() => ({ update }));
  });

  function mockPin(hasPin: boolean, applied = false) {
    rpc.mockImplementation((fn: string) => {
      if (fn === 'user_has_security_pin') {
        return Promise.resolve({ data: hasPin, error: null });
      }
      if (fn === 'apply_pin_reset') {
        return Promise.resolve({ data: applied, error: null });
      }
      return Promise.resolve({ data: null, error: { message: 'unexpected rpc' } });
    });
  }

  function request(pin = '123456') {
    return new Request('http://localhost/api/security/set-pin', {
      method: 'POST',
      body: JSON.stringify({ pin }),
    });
  }

  it('writes the first PIN through the service client without reading the hash', async () => {
    mockPin(false);

    const response = await POST(request() as never);

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('user_has_security_pin', { p_user_id: 'user-1' });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ security_pin_hash: 'hashed-pin' })
    );
    expect(readPinResetGrant).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalledWith('apply_pin_reset', expect.anything());
  });

  it('refuses to replace an existing PIN without a reset grant', async () => {
    mockPin(true);
    (readPinResetGrant as jest.Mock).mockResolvedValue(null);

    const response = await POST(request() as never);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toMatch(/reset code/i);
    expect(update).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalledWith('apply_pin_reset', expect.anything());
  });

  it('rejects a reset grant that was already consumed', async () => {
    mockPin(true, false);
    (readPinResetGrant as jest.Mock).mockResolvedValue(GRANT_ID);

    const response = await POST(request() as never);

    expect(response.status).toBe(403);
    expect(update).not.toHaveBeenCalled();
    expect(createSecuritySessionToken).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith('apply_pin_reset', {
      p_user_id: 'user-1',
      p_grant_id: GRANT_ID,
      p_pin_hash: 'hashed-pin',
    });
  });

  it('replaces an existing PIN only when the grant is consumed', async () => {
    mockPin(true, true);
    (readPinResetGrant as jest.Mock).mockResolvedValue(GRANT_ID);

    const response = await POST(request() as never);

    expect(response.status).toBe(200);
    expect(update).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith('apply_pin_reset', expect.objectContaining({
      p_grant_id: GRANT_ID,
      p_pin_hash: 'hashed-pin',
    }));
    expect(createSecuritySessionToken).toHaveBeenCalledWith('user-1', 'pin_verified');
    expect(cookies).toHaveBeenCalled();
  });
});
