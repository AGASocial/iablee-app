import { routing } from '@/i18n/routing';

export type EmailLocale = 'en' | 'es';

export function resolveEmailLocale(locale?: string | null): EmailLocale {
  if (locale === 'en' || locale === 'es') {
    return locale;
  }
  return routing.defaultLocale as EmailLocale;
}

interface BeneficiaryVerificationEmailCopy {
  ownerFallback: string;
  subject: (ownerName: string) => string;
  inlineHtml: (params: {
    beneficiaryName: string;
    ownerName: string | null;
    verificationUrl: string;
    expiryHours: number;
  }) => string;
}

const COPY: Record<EmailLocale, BeneficiaryVerificationEmailCopy> = {
  es: {
    ownerFallback: 'Un usuario de Iablee',
    subject: (ownerName) => `${ownerName} te ha agregado como beneficiario en Iablee`,
    inlineHtml: ({ beneficiaryName, ownerName, verificationUrl, expiryHours }) => {
      const ownerLine = ownerName
        ? `<p><strong>${ownerName}</strong> te ha registrado como beneficiario en Iablee.</p>`
        : `<p>Has sido registrado como beneficiario en Iablee.</p>`;

      return `
        <div style="font-family: sans-serif; max-width: 560px; margin: 0 auto; color: #1f2937;">
          <h2 style="color: #111827;">Confirma tu correo electrónico</h2>
          <p>Hola ${beneficiaryName},</p>
          ${ownerLine}
          <p>Para confirmar que este correo es correcto, haz clic en el siguiente enlace:</p>
          <p style="margin: 24px 0;">
            <a href="${verificationUrl}" style="background: #2563eb; color: #fff; padding: 12px 20px; border-radius: 8px; text-decoration: none; display: inline-block;">
              Confirmar correo
            </a>
          </p>
          <p style="font-size: 14px; color: #6b7280;">Este enlace expira en ${expiryHours} horas.</p>
          <p style="font-size: 14px; color: #6b7280;">Si no esperabas este mensaje, puedes ignorarlo.</p>
        </div>
      `;
    },
  },
  en: {
    ownerFallback: 'An Iablee user',
    subject: (ownerName) => `${ownerName} has added you as a beneficiary on Iablee`,
    inlineHtml: ({ beneficiaryName, ownerName, verificationUrl, expiryHours }) => {
      const ownerLine = ownerName
        ? `<p><strong>${ownerName}</strong> has added you as a beneficiary on Iablee.</p>`
        : `<p>You have been added as a beneficiary on Iablee.</p>`;

      return `
        <div style="font-family: sans-serif; max-width: 560px; margin: 0 auto; color: #1f2937;">
          <h2 style="color: #111827;">Confirm your email address</h2>
          <p>Hi ${beneficiaryName},</p>
          ${ownerLine}
          <p>Please click the link below to confirm this email address is correct:</p>
          <p style="margin: 24px 0;">
            <a href="${verificationUrl}" style="background: #2563eb; color: #fff; padding: 12px 20px; border-radius: 8px; text-decoration: none; display: inline-block;">
              Confirm email
            </a>
          </p>
          <p style="font-size: 14px; color: #6b7280;">This link expires in ${expiryHours} hours.</p>
          <p style="font-size: 14px; color: #6b7280;">If you weren't expecting this message, you can safely ignore it.</p>
        </div>
      `;
    },
  },
};

export function getBeneficiaryVerificationCopy(locale?: string | null) {
  return COPY[resolveEmailLocale(locale)];
}

export function getBeneficiaryVerificationTemplateId(locale?: string | null): string | undefined {
  const resolved = resolveEmailLocale(locale);
  if (resolved === 'en') {
    return process.env.RESEND_BENEFICIARY_VERIFICATION_TEMPLATE_ID_EN;
  }
  return process.env.RESEND_BENEFICIARY_VERIFICATION_TEMPLATE_ID;
}
