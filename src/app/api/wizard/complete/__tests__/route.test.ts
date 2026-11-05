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

  it('falls back and compensates by deleting the asset when beneficiary creation fails', async () => {
    const assetDeleteEq = jest.fn().mockResolvedValue({ error: null });
    const assetInsert = jest.fn().mockReturnValue({
      select: () => ({
        single: async () => ({ data: { id: 'asset-2' }, error: null }),
      }),
    });

    (getAuthenticatedContext as jest.Mock).mockResolvedValue({
      ok: true,
      ctx: {
        user: { id: 'user-1' },
        hasPin: true,
        hasSecuritySession: true,
        pinRequired: false,
        supabase: {
          from: (table: string) => {
            if (table === 'beneficiaries') {
              return {
                insert: () => ({
                  select: () => ({
                    single: async () => ({ data: null, error: { message: 'beneficiary failed' } }),
                  }),
                }),
              };
            }
            if (table === 'asset_attachments') {
              return { insert: jest.fn().mockResolvedValue({ error: null }) };
            }
            return { insert: jest.fn().mockResolvedValue({ error: null }) };
          },
        },
      },
    });
    (canCreateAsset as jest.Mock).mockResolvedValue({ allowed: true });
    (canCreateBeneficiary as jest.Mock).mockResolvedValue({ allowed: true });
    (supabaseAdmin.rpc as jest.Mock).mockResolvedValue({
      data: null,
      error: { code: 'PGRST202', message: 'Function not found' },
    });
    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'digital_assets') {
        return {
          insert: assetInsert,
          delete: () => ({ eq: assetDeleteEq }),
          update: () => ({ eq: jest.fn().mockResolvedValue({ error: null }) }),
        };
      }
      if (table === 'wizard_completion_idempotency') {
        return {
          update: () => ({ match: jest.fn().mockResolvedValue({ error: null }) }),
        };
      }
      return {
        insert: jest.fn(),
        update: () => ({ eq: jest.fn().mockResolvedValue({ error: null }) }),
      };
    });

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toContain('beneficiary failed');
    expect(assetDeleteEq).toHaveBeenCalledWith('id', 'asset-2');
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
});
