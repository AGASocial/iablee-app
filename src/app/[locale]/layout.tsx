import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "../globals.css";
import { NextIntlClientProvider } from 'next-intl';
import { notFound } from 'next/navigation';
import ClientLayout from "@/components/ClientLayout";
import ThemeRegistry from "@/components/ThemeRegistry";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "iablee - Digital Inheritance Platform",
  description: "Secure and manage your digital legacy with iablee",
};

export default async function RootLayout({
  children,
  params
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  
  let messages;
  try {
    messages = (await import(`../../../messages/${locale}.json`)).default;
  } catch {
    notFound();
  }

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className={inter.className} suppressHydrationWarning>
        <ThemeRegistry>
          <NextIntlClientProvider locale={locale} messages={messages}>
            <ClientLayout>
              {children}
            </ClientLayout>
          </NextIntlClientProvider>
        </ThemeRegistry>
      </body>
    </html>
  );
} 