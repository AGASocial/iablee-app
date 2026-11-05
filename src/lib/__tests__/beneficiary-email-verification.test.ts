/**
 * @jest-environment node
 */
import { supabaseAdmin } from '@/lib/supabase-admin';
import {
  sendBeneficiaryVerificationEmail,
  verifyBeneficiaryEmailToken,
} from '@/lib/beneficiary-email-verification';

jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { from: jest.fn() },
}));

jest.mock('@/lib/beneficiary-email-copy', () => ({
  resolveEmailLocale: () => 'en',
  getBeneficiaryVerificationTemplateId: () => null,
  getBeneficiaryVerificationCopy: () => ({
    ownerFallback: 'Owner',
    subject: () => 'subject',
    inlineHtml: () => '<p>hi</p>',
  }),
}));

jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: (...args: unknown[]) => mockSendEmail(...args) },
  })),
}));

const mockSendEmail = jest.fn();

describe('beneficiary email verification', () => {
  const inserts: Record<string, unknown>[] = [];
  const updates: { table: string; payload: Record<string, unknown> }[] = [];

  beforeEach(() => {
    jest.clearAllMocks();
    inserts.length = 0;
    updates.length = 0;
    process.env.RESEND_API_KEY = 'test-key';
    mockSendEmail.mockResolvedValue({ error: null });
  });

  function verificationRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'ver-1',
      beneficiary_id: 'ben-1',
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      used_at: null,
      email: 'heir@example.com',
      beneficiary: { full_name: 'Ada', email: 'heir@example.com' },
      ...overrides,
    };
  }

  function mockAdmin(record: Record<string, unknown> | null) {
    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'beneficiary_email_verifications') {
        return {
          update: (payload: Record<string, unknown>) => {
            updates.push({ table, payload });
            const builder = {
              eq: jest.fn(),
              is: jest.fn(),
              select: jest.fn(),
              maybeSingle: jest.fn(async () => ({ data: { id: 'ver-1' }, error: null })),
            };
            builder.eq.mockReturnValue(builder);
            builder.is.mockReturnValue(builder);
            builder.select.mockReturnValue(builder);
            return builder;
          },
          insert: async (payload: Record<string, unknown>) => {
            inserts.push(payload);
            return { error: null };
          },
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: record, error: null }),
            }),
          }),
        };
      }

      return {
        update: (payload: Record<string, unknown>) => {
          updates.push({ table, payload });
          return { eq: async () => ({ error: null }) };
        },
      };
    });
  }

  it('stores the normalized recipient email with the token', async () => {
    mockAdmin(null);

    const result = await sendBeneficiaryVerificationEmail({
      beneficiaryId: 'ben-1',
      beneficiaryName: 'Ada',
      email: '  Heir@Example.com ',
    });

    expect(result.sent).toBe(true);
    expect(inserts[0]).toEqual(expect.objectContaining({
      beneficiary_id: 'ben-1',
      email: 'heir@example.com',
    }));
  });

  it('verifies only when the token email matches the beneficiary email', async () => {
    mockAdmin(verificationRow({ email: 'heir@example.com', beneficiary: { full_name: 'Ada', email: ' Heir@Example.com ' } }));

    const result = await verifyBeneficiaryEmailToken('abc');

    expect(result).toEqual({ ok: true, beneficiaryName: 'Ada' });
    expect(updates.some((update) => update.table === 'beneficiaries' && update.payload.email_verified === true)).toBe(true);
  });

  it('does not verify a beneficiary after the email changed', async () => {
    mockAdmin(verificationRow({
      email: 'old@example.com',
      beneficiary: { full_name: 'Ada', email: 'new@example.com' },
    }));

    const result = await verifyBeneficiaryEmailToken('abc');

    expect(result).toEqual({ ok: false, reason: 'invalid' });
    expect(updates.some((update) => update.table === 'beneficiaries')).toBe(false);
    expect(updates.some((update) => update.table === 'beneficiary_email_verifications' && update.payload.used_at)).toBe(true);
  });

  it('rejects a token that has no stored email', async () => {
    mockAdmin(verificationRow({ email: null }));

    const result = await verifyBeneficiaryEmailToken('abc');

    expect(result).toEqual({ ok: false, reason: 'invalid' });
    expect(updates.some((update) => update.table === 'beneficiaries')).toBe(false);
  });
});
