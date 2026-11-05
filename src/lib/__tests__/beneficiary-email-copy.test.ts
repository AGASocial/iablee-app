/**
 * @jest-environment node
 */
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getBeneficiaryVerificationCopy } from '@/lib/beneficiary-email-copy';
import { sendBeneficiaryVerificationEmail } from '@/lib/beneficiary-email-verification';

jest.mock('@/i18n/routing', () => ({
  routing: { defaultLocale: 'es', locales: ['en', 'es'] },
}));

jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { from: jest.fn() },
}));

const mockSendEmail = jest.fn();

jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: (...args: unknown[]) => mockSendEmail(...args) },
  })),
}));

const BENEFICIARY_NAME = '<a href="https://evil.example">Confirmar correo</a>';
const OWNER_NAME = '<img src=x onerror=alert(1)>';

describe('beneficiary verification email copy', () => {
  const templateEnv = {
    en: process.env.RESEND_BENEFICIARY_VERIFICATION_TEMPLATE_ID_EN,
    es: process.env.RESEND_BENEFICIARY_VERIFICATION_TEMPLATE_ID,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.RESEND_API_KEY = 'test-key';
    delete process.env.RESEND_BENEFICIARY_VERIFICATION_TEMPLATE_ID_EN;
    delete process.env.RESEND_BENEFICIARY_VERIFICATION_TEMPLATE_ID;
    mockSendEmail.mockResolvedValue({ error: null });
    (supabaseAdmin.from as jest.Mock).mockImplementation(() => ({
      update: () => {
        const builder = { eq: jest.fn(), is: jest.fn() };
        builder.eq.mockReturnValue(builder);
        builder.is.mockReturnValue(builder);
        return builder;
      },
      insert: async () => ({ error: null }),
    }));
  });

  afterAll(() => {
    if (templateEnv.en === undefined) delete process.env.RESEND_BENEFICIARY_VERIFICATION_TEMPLATE_ID_EN;
    else process.env.RESEND_BENEFICIARY_VERIFICATION_TEMPLATE_ID_EN = templateEnv.en;
    if (templateEnv.es === undefined) delete process.env.RESEND_BENEFICIARY_VERIFICATION_TEMPLATE_ID;
    else process.env.RESEND_BENEFICIARY_VERIFICATION_TEMPLATE_ID = templateEnv.es;
  });

  it('escapes owner and beneficiary names in the html and the subject', () => {
    const copy = getBeneficiaryVerificationCopy('es');
    const html = copy.inlineHtml({
      beneficiaryName: BENEFICIARY_NAME,
      ownerName: OWNER_NAME,
      verificationUrl: 'https://app.iablee.test/api/beneficiaries/verify-email?token=abc&locale=es',
      expiryHours: 48,
    });

    expect(html).not.toContain('<a href="https://evil.example">');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;a href=&quot;https://evil.example&quot;&gt;Confirmar correo&lt;/a&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('href="https://app.iablee.test/api/beneficiaries/verify-email?token=abc&amp;locale=es"');
    expect(html).toContain('Confirmar correo');
    expect(copy.subject(`${OWNER_NAME}\nBcc: evil@example.com`)).toBe(
      '&lt;img src=x onerror=alert(1)&gt; Bcc: evil@example.com te ha agregado como beneficiario en Iablee'
    );
    expect(copy.subject(OWNER_NAME)).not.toContain('<');
  });

  it('escapes template variables sent to the provider', async () => {
    process.env.RESEND_BENEFICIARY_VERIFICATION_TEMPLATE_ID_EN = 'tmpl-en';

    const result = await sendBeneficiaryVerificationEmail({
      beneficiaryId: 'ben-1',
      beneficiaryName: BENEFICIARY_NAME,
      ownerName: OWNER_NAME,
      email: 'heir@example.com',
      locale: 'en',
    });

    expect(result.sent).toBe(true);
    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({
      subject: '&lt;img src=x onerror=alert(1)&gt; has added you as a beneficiary on Iablee',
      template: {
        id: 'tmpl-en',
        variables: expect.objectContaining({
          BENEFICIARY_NAME: '&lt;a href=&quot;https://evil.example&quot;&gt;Confirmar correo&lt;/a&gt;',
          OWNER_NAME: '&lt;img src=x onerror=alert(1)&gt;',
        }),
      },
    }));
    const payload = mockSendEmail.mock.calls[0][0] as { html?: string; subject: string };
    expect(payload.html).toBeUndefined();
    expect(payload.subject).not.toContain('<');
  });
});
