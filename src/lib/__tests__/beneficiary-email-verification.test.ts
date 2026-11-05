/**
 * @jest-environment node
 */
import { supabaseAdmin } from '@/lib/supabase-admin';
import {
  sendBeneficiaryVerificationEmail,
  verifyBeneficiaryEmailToken,
} from '@/lib/beneficiary-email-verification';

jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { from: jest.fn(), rpc: jest.fn() },
}));

jest.mock('@/lib/beneficiary-email-copy', () => ({
  resolveEmailLocale: () => 'en',
  getBeneficiaryVerificationTemplateId: () => null,
  escapeHtml: (value: string) => value,
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

  it('returns a fixed message when the email provider fails', async () => {
    mockAdmin(null);
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockSendEmail.mockResolvedValue({
      error: { message: 'Invalid API key re_secret_value', name: 'validation_error' },
    });

    const result = await sendBeneficiaryVerificationEmail({
      beneficiaryId: 'ben-1',
      beneficiaryName: 'Ada',
      email: 'heir@example.com',
    });

    expect(result).toEqual({ sent: false, error: 'Failed to send verification email' });
    expect(JSON.stringify(result)).not.toContain('re_secret_value');
    expect(spy).toHaveBeenCalledWith(
      'Error sending beneficiary verification email:',
      expect.objectContaining({ message: 'Invalid API key re_secret_value' })
    );
    spy.mockRestore();
  });

  it('verifies through one database call and does not update the beneficiary itself', async () => {
    (supabaseAdmin.rpc as jest.Mock).mockResolvedValue({
      data: [{ status: 'success', beneficiary_name: 'Ada' }],
      error: null,
    });

    const result = await verifyBeneficiaryEmailToken('abc');

    expect(result).toEqual({ ok: true, beneficiaryName: 'Ada' });
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith('verify_beneficiary_email', {
      p_token_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });

  it('maps a mismatched token email to invalid', async () => {
    (supabaseAdmin.rpc as jest.Mock).mockResolvedValue({
      data: [{ status: 'invalid', beneficiary_name: null }],
      error: null,
    });

    const result = await verifyBeneficiaryEmailToken('abc');

    expect(result).toEqual({ ok: false, reason: 'invalid' });
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });

  it('maps an empty stored email to invalid', async () => {
    (supabaseAdmin.rpc as jest.Mock).mockResolvedValue({
      data: [{ status: 'invalid', beneficiary_name: null }],
      error: null,
    });

    const result = await verifyBeneficiaryEmailToken('abc');

    expect(result).toEqual({ ok: false, reason: 'invalid' });
  });
});
