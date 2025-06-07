"use client";

import { usePathname } from 'next/navigation';
import Navigation from "@/components/Navigation";
import Navbar from "@/components/Navbar";
import { Toaster } from "sonner";

export default function LayoutWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAuthPage = pathname?.includes('/auth');

  if (isAuthPage) {
    return (
      <div className="min-h-screen">
        {children}
        <Toaster richColors closeButton position="top-right" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      <aside className="w-64 bg-white dark:bg-gray-800 border-r dark:border-gray-700">
        <div className="flex flex-col h-full">
          <div className="p-4">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">iablee</h1>
          </div>
          <Navigation />
        </div>
      </aside>

      <main className="flex-1 bg-gray-50 dark:bg-gray-900 flex flex-col">
        <Navbar />
        <div className="flex-1">
          {children}
        </div>
      </main>
      <Toaster richColors closeButton position="top-right" />
    </div>
  );
} 