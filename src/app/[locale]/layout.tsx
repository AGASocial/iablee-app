import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "../globals.css";
import { Toaster } from "sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { NextIntlClientProvider } from 'next-intl';
import { notFound } from 'next/navigation';
import LanguageSwitcher from "@/components/LanguageSwitcher";
import Navigation from "@/components/Navigation";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "iablee - Digital Inheritance Platform",
  description: "Secure and manage your digital legacy with iablee",
};


export default async function LocaleLayout({
  children,
  params: { locale },
}: {
  children: React.ReactNode,
  params: { locale: string }
}) {
  let messages;
  try {
    messages = (await import(`../../../messages/${locale}.json`)).default;
  } catch (error) {
    notFound();
  }

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className={inter.className}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <NextIntlClientProvider locale={locale} messages={messages}>
            <div className="flex min-h-screen">
              <aside className="w-64 bg-white dark:bg-gray-800 border-r dark:border-gray-700">
                <div className="flex flex-col h-full">
                  <div className="p-4">
                    <h1 className="text-2xl font-bold">iablee</h1>
                  </div>
                  <Navigation />
                  <div className="p-4 border-t dark:border-gray-700">
                    <LanguageSwitcher />
                  </div>
                </div>
              </aside>
              <main className="flex-1 bg-gray-50 dark:bg-gray-900">
                {children}
              </main>
            </div>
          </NextIntlClientProvider>
          <Toaster richColors closeButton position="top-right" />
        </ThemeProvider>
      </body>
    </html>
  );
} 