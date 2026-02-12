import { NextIntlClientProvider } from 'next-intl';
import { notFound } from 'next/navigation';
import ClientLayout from "@/components/ClientLayout";

export default async function DashboardLayout({
    children,
    params
}: {
    children: React.ReactNode;
    params: Promise<{ locale: string }>;
}) {
    const { locale } = await params;

    let messages;
    try {
        // Import messages for the client components
        messages = (await import(`../../../../messages/${locale}.json`)).default;
    } catch {
        notFound();
    }

    return (
        <NextIntlClientProvider locale={locale} messages={messages}>
            <ClientLayout>
                {children}
            </ClientLayout>
        </NextIntlClientProvider>
    );
}
