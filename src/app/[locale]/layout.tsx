import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "../globals.css";
import { Toaster } from "sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { NextIntlClientProvider } from 'next-intl';
import { notFound } from 'next/navigation';
import Navigation from "@/components/Navigation";
import Navbar from "@/components/Navbar";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "iablee - Digital Inheritance Platform",
  description: "Secure and manage your digital legacy with iablee",
};

async function RootLayout({ children, locale }: { children: React.ReactNode; locale: string }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <body className={inter.className}>
        <div className="flex min-h-screen">
          {/* Side Navigation */}
          <aside className="w-64 bg-white dark:bg-gray-800 border-r dark:border-gray-700">
            <div className="flex flex-col h-full">
              <div className="p-4">
                <h1 className="text-2xl font-bold">iablee</h1>
              </div>
              <Navigation />
            </div>
          </aside>

          {/* Main Content */}
          <main className="flex-1 bg-gray-50 dark:bg-gray-900 flex flex-col">
            <Navbar />
            <div className="flex-1">
              {children}
            </div>
          </main>
        </div>
        <Toaster richColors closeButton position="top-right" />
      </body>
    </ThemeProvider>
  );
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode,
  params: { locale: string }
}) {
  const { locale } = params;
  let messages;
  try {
    messages = (await import(`../../../messages/${locale}.json`)).default;
  } catch (error) {
    notFound();
  }

  return (
    <html lang={locale} suppressHydrationWarning>
      <NextIntlClientProvider locale={locale} messages={messages}>
        <RootLayout locale={locale}>{children}</RootLayout>
      </NextIntlClientProvider>
    </html>
  );
} 