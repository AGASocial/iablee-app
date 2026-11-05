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
  supabaseAdmin: { from: jest.fn() },
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
      body: JSON.stringify({
        asset: { assetType: 'letter', assetName: 'Note' },
        beneficiary: { fullName: 'Ana', email: '  Ana@Example.COM ' },
      }),
    }) as never;
  }

  it('stores the beneficiary email trimmed and lowercased', async () => {
    const beneficiaryInsert = jest.fn().mockReturnValue({
      select: () => ({
        single: async () => ({ data: { id: 'ben-1', full_name: 'Ana' }, error: null }),
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
            if (table === 'beneficiaries') return { insert: beneficiaryInsert };
            return { insert: jest.fn().mockResolvedValue({ error: null }) };
          },
        },
      },
    });
    (canCreateAsset as jest.Mock).mockResolvedValue({ allowed: true });
    (canCreateBeneficiary as jest.Mock).mockResolvedValue({ allowed: true });
    (maybeSendBeneficiaryVerificationEmail as jest.Mock).mockResolvedValue({
      verificationSent: false,
    });
    (supabaseAdmin.from as jest.Mock).mockImplementation(() => ({
      insert: () => ({
        select: () => ({
          single: async () => ({ data: { id: 'asset-1' }, error: null }),
        }),
      }),
      update: () => ({
        eq: async () => ({ error: null }),
      }),
    }));

    const response = await POST(request());

    expect(response.status).toBe(201);
    expect(beneficiaryInsert).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'ana@example.com' })
    );
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
    expect(canCreateAsset).not.toHaveBeenCalled();
  });
});
