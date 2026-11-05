/**
 * @jest-environment node
 */
import { POST } from '../route';
import { createAuthenticatedRouteClient } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { canCreateAsset, canCreateBeneficiary } from '@/lib/subscription/limits';
import { maybeSendBeneficiaryVerificationEmail } from '@/lib/beneficiary-verification-flow';

jest.mock('@/lib/supabase-server', () => ({
  createAuthenticatedRouteClient: jest.fn(),
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
  it('stores the beneficiary email trimmed and lowercased', async () => {
    const beneficiaryInsert = jest.fn().mockReturnValue({
      select: () => ({
        single: async () => ({ data: { id: 'ben-1', full_name: 'Ana' }, error: null }),
      }),
    });

    (createAuthenticatedRouteClient as jest.Mock).mockResolvedValue({
      user: { id: 'user-1' },
      supabase: {
        from: (table: string) => {
          if (table === 'beneficiaries') return { insert: beneficiaryInsert };
          return { insert: jest.fn().mockResolvedValue({ error: null }) };
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

    const response = await POST(new Request('http://localhost/api/wizard/complete', {
      method: 'POST',
      body: JSON.stringify({
        asset: { assetType: 'letter', assetName: 'Note' },
        beneficiary: { fullName: 'Ana', email: '  Ana@Example.COM ' },
      }),
    }) as never);

    expect(response.status).toBe(201);
    expect(beneficiaryInsert).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'ana@example.com' })
    );
  });
});
