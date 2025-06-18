"use client";

import { usePathname } from 'next/navigation';
import Navigation from "@/components/Navigation";
import Navbar from "@/components/Navbar";
import { Toaster } from "sonner";
import { useState } from "react";

export default function LayoutWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAuthPage = pathname?.includes('/auth');
  const [sidebarOpen, setSidebarOpen] = useState(false);

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
      {/* Sidebar for desktop */}
      <aside className="hidden md:block w-64 bg-white dark:bg-gray-800 border-r dark:border-gray-700">
        <div className="flex flex-col h-full">
          <div className="p-4">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">iablee</h1>
          </div>
          <Navigation />
        </div>
      </aside>

      {/* Sidebar drawer for mobile */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 flex md:hidden">
          <div className="relative flex w-64 flex-col bg-white dark:bg-gray-800 border-r dark:border-gray-700 h-full">
            <div className="flex items-center justify-between p-4 border-b">
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">iablee</h1>
              <button onClick={() => setSidebarOpen(false)} className="text-gray-900 dark:text-white text-2xl">&times;</button>
            </div>
            <Navigation closeSidebar={() => setSidebarOpen(false)} />
          </div>
          <div className="flex-1 bg-black bg-opacity-40" onClick={() => setSidebarOpen(false)} />
        </div>
      )}

      <main className="flex-1 bg-gray-50 dark:bg-gray-900 flex flex-col">
        <Navbar onMenuClick={() => setSidebarOpen(true)} />
        <div className="flex-1">
          {children}
        </div>
      </main>
      <Toaster richColors closeButton position="top-right" />
    </div>
  );
} 