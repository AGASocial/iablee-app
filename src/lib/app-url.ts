export function getAppUrl(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) {
    return configured.replace(/\/$/, '');
  }

  const vercelUrl = process.env.VERCEL_URL?.trim();
  if (vercelUrl) {
    return `https://${vercelUrl}`;
  }

  return 'http://localhost:3000';
}

const AUTH_LOCALES = ['en', 'es'] as const;
export type AuthLocale = (typeof AUTH_LOCALES)[number];

function isAuthLocale(locale: unknown): locale is AuthLocale {
  return AUTH_LOCALES.some((value) => value === locale);
}

function originFrom(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Fixed origin for Supabase auth redirects (OAuth, signup, recovery, callback).
 * Never read Origin, Host, or X-Forwarded-* for this — the caller can set them.
 *
 * NEXT_PUBLIC_SITE_URL wins. Otherwise getAppUrl() supplies NEXT_PUBLIC_APP_URL,
 * then VERCEL_URL, then http://localhost:3000. Production site URL is documented
 * in docs/supabase-redirect-setup.md (https://app.iablee.com); set
 * NEXT_PUBLIC_SITE_URL to that value in deployed environments.
 */
export function getAuthRedirectOrigin(): string {
  return originFrom(process.env.NEXT_PUBLIC_SITE_URL) ?? originFrom(getAppUrl()) ?? 'http://localhost:3000';
}

/** Auth emails and OAuth return paths only accept the app locales. */
export function resolveAuthLocale(locale: unknown): AuthLocale {
  return isAuthLocale(locale) ? locale : 'en';
}
