import { redirect } from '@/i18n/navigation';
import { getPostLoginRedirect } from '@/lib/server/data';
import { createAuthenticatedRouteClient } from '@/lib/supabase-server';
import LandingPage from './LandingPage';

export default async function LocalePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const { user } = await createAuthenticatedRouteClient();

  if (user) {
    const target = await getPostLoginRedirect();
    redirect({ href: target, locale });
  }

  return <LandingPage />;
}
