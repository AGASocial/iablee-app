/**
 * @jest-environment node
 */
import { POST } from '../route';
import { getAuthenticatedContext } from '@/lib/auth-context';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { canCreateAsset, canCreateBeneficiary } from '@/lib/subscription/limits';
import { maybeSendBeneficiaryVerificationEmail } from '@/lib/beneficiary-verification-flow';

jest.mock('@/lib/auth-context', () => ({
  getAuthenticatedContext: jest.fn(),
}));
jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { from: jest.fn(), rpc: jest.fn() },
}));
jest.mock('@/lib/subscription/limits', () => ({
  canCreateAsset: jest.fn(),
  canCreateBeneficiary: jest.fn(),
}));
jest.mock('@/lib/beneficiary-verification-flow', () => ({
  maybeSendBeneficiaryVerificationEmail: jest.fn(),
}));

describe('POST /api/wizard/complete', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function request() {
    return new Request('http://localhost/api/wizard/complete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': '0f3d2068-6ef6-4f17-849f-8d0ee8f02153',
      },
      body: JSON.stringify({
        asset: { assetType: 'letter', assetName: 'Note' },
        beneficiary: { fullName: 'Ana', email: '  Ana@Example.COM ' },
        idempotencyKey: '0f3d2068-6ef6-4f17-849f-8d0ee8f02153',
      }),
    }) as never;
  }

  it('stores the beneficiary email trimmed and lowercased', async () => {
    (getAuthenticatedContext as jest.Mock).mockResolvedValue({
      ok: true,
      ctx: {
        user: { id: 'user-1' },
        hasPin: true,
        hasSecuritySession: true,
        pinRequired: false,
        supabase: { from: jest.fn() },
      },
    });
    (canCreateAsset as jest.Mock).mockResolvedValue({ allowed: true });
    (canCreateBeneficiary as jest.Mock).mockResolvedValue({ allowed: true });
    (maybeSendBeneficiaryVerificationEmail as jest.Mock).mockResolvedValue({
      verificationSent: false,
    });
    (supabaseAdmin.rpc as jest.Mock).mockResolvedValue({
      data: {
        idempotent: false,
        result: {
          asset: { id: 'asset-1' },
          beneficiary: { id: 'ben-1', full_name: 'Ana' },
        },
      },
      error: null,
    });
    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'digital_assets') {
        return {
          insert: () => ({
            select: () => ({
              single: async () => ({ data: { id: 'asset-1' }, error: null }),
            }),
          }),
          update: () => ({
            eq: async () => ({ error: null }),
          }),
        };
      }
      if (table === 'wizard_completion_idempotency') {
        return {
          update: () => ({
            match: async () => ({ error: null }),
          }),
        };
      }
      return {
        update: () => ({
          eq: async () => ({ error: null }),
        }),
      };
    });

    const response = await POST(request());

    expect(response.status).toBe(201);
    expect(maybeSendBeneficiaryVerificationEmail).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'ana@example.com' }),
    );
  });

  it('returns the previous response for the same idempotency key', async () => {
    (getAuthenticatedContext as jest.Mock).mockResolvedValue({
      ok: true,
      ctx: {
        user: { id: 'user-1' },
        hasPin: true,
        hasSecuritySession: true,
        pinRequired: false,
        supabase: { from: jest.fn() },
      },
    });
    (canCreateAsset as jest.Mock).mockResolvedValue({ allowed: true });
    (canCreateBeneficiary as jest.Mock).mockResolvedValue({ allowed: true });
    (supabaseAdmin.rpc as jest.Mock).mockResolvedValue({
      data: {
        idempotent: true,
        result: {
          asset: { id: 'asset-1' },
          beneficiary: { id: 'ben-1', full_name: 'Ana' },
          verificationSent: true,
        },
      },
      error: null,
    });

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.idempotent).toBe(true);
    expect(body.asset.id).toBe('asset-1');
    expect(maybeSendBeneficiaryVerificationEmail).not.toHaveBeenCalled();
  });

  it('returns 503 SERVICE_UPDATING when the transactional RPC is not deployed yet', async () => {
    (getAuthenticatedContext as jest.Mock).mockResolvedValue({
      ok: true,
      ctx: {
        user: { id: 'user-1' },
        hasPin: true,
        hasSecuritySession: true,
        pinRequired: false,
        supabase: { from: jest.fn() },
      },
    });
    (canCreateAsset as jest.Mock).mockResolvedValue({ allowed: true });
    (canCreateBeneficiary as jest.Mock).mockResolvedValue({ allowed: true });
    (supabaseAdmin.rpc as jest.Mock).mockResolvedValue({
      data: null,
      error: { code: 'PGRST202', message: 'Function not found' },
    });

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({ error: 'SERVICE_UPDATING' });
    expect(maybeSendBeneficiaryVerificationEmail).not.toHaveBeenCalled();
  });

  it('returns 409 IDEMPOTENCY_IN_PROGRESS when key is locked by another request', async () => {
    (getAuthenticatedContext as jest.Mock).mockResolvedValue({
      ok: true,
      ctx: {
        user: { id: 'user-1' },
        hasPin: true,
        hasSecuritySession: true,
        pinRequired: false,
        supabase: { from: jest.fn() },
      },
    });
    (canCreateAsset as jest.Mock).mockResolvedValue({ allowed: true });
    (canCreateBeneficiary as jest.Mock).mockResolvedValue({ allowed: true });
    (supabaseAdmin.rpc as jest.Mock).mockResolvedValue({
      data: null,
      error: { code: '55P03', message: 'idempotency key is currently being processed' },
    });

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({ error: 'IDEMPOTENCY_IN_PROGRESS', retryable: true });
  });

  it('returns 409 IDEMPOTENCY_IN_PROGRESS on idempotency unique violation', async () => {
    (getAuthenticatedContext as jest.Mock).mockResolvedValue({
      ok: true,
      ctx: {
        user: { id: 'user-1' },
        hasPin: true,
        hasSecuritySession: true,
        pinRequired: false,
        supabase: { from: jest.fn() },
      },
    });
    (canCreateAsset as jest.Mock).mockResolvedValue({ allowed: true });
    (canCreateBeneficiary as jest.Mock).mockResolvedValue({ allowed: true });
    (supabaseAdmin.rpc as jest.Mock).mockResolvedValue({
      data: null,
      error: {
        code: '23505',
        message: 'duplicate key value violates unique constraint',
        details: 'Key (user_id, idempotency_key) already exists in wizard_completion_idempotency',
      },
    });

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({ error: 'IDEMPOTENCY_IN_PROGRESS', retryable: true });
  });

  it('rejects the write when a security PIN is required', async () => {
    (getAuthenticatedContext as jest.Mock).mockResolvedValue({
      ok: false,
      status: 403,
      error: 'Security PIN required',
    });

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe('Security PIN required');
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled();
    expect(canCreateAsset).not.toHaveBeenCalled();
    expect(maybeSendBeneficiaryVerificationEmail).not.toHaveBeenCalled();
  });

  it('returns 403 when the user has no configured PIN', async () => {
    (getAuthenticatedContext as jest.Mock).mockResolvedValue({
      ok: true,
      ctx: {
        user: { id: 'user-1' },
        hasPin: false,
        hasSecuritySession: false,
        pinRequired: false,
        supabase: { from: jest.fn() },
      },
    });

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe('Security PIN required');
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled();
    expect(canCreateAsset).not.toHaveBeenCalled();
  });

  it('returns 403 when the PIN session is locked', async () => {
    (getAuthenticatedContext as jest.Mock).mockResolvedValue({
      ok: true,
      ctx: {
        user: { id: 'user-1' },
        hasPin: true,
        hasSecuritySession: false,
        pinRequired: true,
        supabase: { from: jest.fn() },
      },
    });

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe('Security PIN required');
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled();
    expect(canCreateAsset).not.toHaveBeenCalled();
  });

  it('returns 400 when request body is invalid JSON', async () => {
    (getAuthenticatedContext as jest.Mock).mockResolvedValue({
      ok: true,
      ctx: {
        user: { id: 'user-1' },
        hasPin: true,
        hasSecuritySession: true,
        pinRequired: false,
        supabase: { from: jest.fn() },
      },
    });

    const badRequest = new Request('http://localhost/api/wizard/complete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': '0f3d2068-6ef6-4f17-849f-8d0ee8f02153',
      },
      body: '{"asset": ',
    }) as never;

    const response = await POST(badRequest);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: 'Invalid request body' });
  });

  it('returns 500 for unexpected runtime failures after body parsing', async () => {
    (getAuthenticatedContext as jest.Mock).mockResolvedValue({
      ok: true,
      ctx: {
        user: { id: 'user-1' },
        hasPin: true,
        hasSecuritySession: true,
        pinRequired: false,
        supabase: { from: jest.fn() },
      },
    });
    (canCreateAsset as jest.Mock).mockRejectedValue(new Error('db unavailable'));
    (canCreateBeneficiary as jest.Mock).mockResolvedValue({ allowed: true });

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'Internal server error' });
  });
});
