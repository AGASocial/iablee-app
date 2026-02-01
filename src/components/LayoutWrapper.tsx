"use client";


import Image from 'next/image';
import Navigation from "@/components/Navigation";
import Navbar from "@/components/Navbar";
import { Toaster } from "sonner";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useTranslations, useLocale } from 'next-intl';
import { useRouter, usePathname, Link } from '@/i18n/navigation';
import { supabase } from '@/lib/supabase';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import { User, LogOut, Languages } from "lucide-react";

export default function LayoutWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAuthPage = pathname?.includes('/auth');

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const t = useTranslations();
  const router = useRouter();
  const locale = useLocale();

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/auth/login');
  };

  const switchLocale = (newLocale: string) => {
    router.replace(pathname, { locale: newLocale });
  };

  if (isAuthPage) {
    return (
      <div className="min-h-screen">
        {children}
        <Toaster richColors closeButton position="top-right" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background">
      {/* Sidebar for desktop */}
      <aside className={cn(
        "hidden md:flex flex-col fixed inset-y-0 z-50 transition-all duration-300",
        sidebarCollapsed ? "w-20" : "w-60"
      )}>
        <div className="relative flex-1 flex flex-col min-h-0 bg-card dark:bg-[#0F172A] border-r border-border dark:border-white/5 shadow-xl transition-all duration-300">
          {/* Logo Area */}
          <div className={cn(
            "flex items-center h-20 border-b border-border dark:border-white/5 bg-card/50 dark:bg-[#0F172A]/50 backdrop-blur-xl transition-all duration-300 shrink-0",
            sidebarCollapsed ? "justify-center px-0" : "px-6"
          )}>
            <div className={cn(
              "relative transition-all duration-300",
              sidebarCollapsed ? "h-16 w-16" : "h-12 w-40"
            )}>
              <Image
                src={sidebarCollapsed ? "/logo-lock.png" : "/logo-iablee.png"}
                alt="iablee"
                fill
                className="object-contain dark:hidden"
                priority
                unoptimized
              />
              <Image
                src={sidebarCollapsed ? "/logo-lock-dark.png" : "/logo-iablee-dark.png"}
                alt="iablee"
                fill
                className="object-contain hidden dark:block"
                priority
                unoptimized
              />
            </div>
          </div>

          {/* Navigation */}
          <div className="flex-1 overflow-y-auto py-6 px-3">
            <Navigation collapsed={sidebarCollapsed} />
          </div>

          {/* Toggle Button */}
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="absolute -right-3 top-20 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg ring-2 ring-background hover:bg-primary/90 transition-colors"
            aria-label="Toggle sidebar"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={cn("h-3 w-3 transition-transform duration-300", sidebarCollapsed ? "rotate-180" : "")}
            >
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>

          {/* User Profile / Footer Area (Optional if needed later) */}
          {/* User Profile / Footer Area */}
          <div className="p-4 border-t border-border dark:border-white/5 bg-muted/20 dark:bg-black/20">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className={cn(
                  "flex items-center gap-3 w-full rounded-lg hover:bg-muted dark:hover:bg-white/5 transition-all p-2 text-left",
                  sidebarCollapsed && "justify-center p-0 hover:bg-transparent"
                )}>
                  <div className={cn(
                    "relative flex items-center justify-center shrink-0 rounded-full bg-primary/10 dark:bg-white/10 text-primary dark:text-white transition-all",
                    sidebarCollapsed ? "h-10 w-10 ring-2 ring-transparent hover:ring-primary/20" : "h-9 w-9"
                  )}>
                    <User className="h-5 w-5" />
                  </div>
                  <div className={cn(
                    "flex-1 overflow-hidden transition-all duration-300",
                    sidebarCollapsed ? "w-0 opacity-0" : "w-auto opacity-100"
                  )}>
                    <p className="text-sm font-medium truncate">{t('profile')}</p>
                    <p className="text-xs text-muted-foreground truncate">{t('profileSettings')}</p>
                  </div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="right" sideOffset={10} className="w-56 p-2">
                <DropdownMenuLabel className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                  {t('profile')}
                </DropdownMenuLabel>
                <DropdownMenuItem asChild>
                  <Link href="/settings" className="cursor-pointer flex w-full items-center rounded-md px-2 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground">
                    <User className="mr-2 h-4 w-4 opacity-70" />
                    <span>{t('profileSettings')}</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className="cursor-pointer rounded-md px-2 py-2 text-sm font-medium transition-colors focus:bg-accent focus:text-accent-foreground">
                    <Languages className="mr-2 h-4 w-4 opacity-70" />
                    <span>{t('language')}</span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="p-1">
                    <DropdownMenuItem onClick={() => switchLocale('en')} className="cursor-pointer">
                      <span className={locale === 'en' ? 'font-bold text-primary' : ''}>English</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => switchLocale('es')} className="cursor-pointer">
                      <span className={locale === 'es' ? 'font-bold text-primary' : ''}>Español</span>
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSeparator className="my-2 bg-border/50" />
                <DropdownMenuItem onClick={handleSignOut} className="cursor-pointer rounded-md px-2 py-2 text-sm font-medium text-destructive focus:bg-destructive/10 focus:text-destructive">
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>{t('signOut')}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <div className={cn(
              "text-xs text-muted-foreground dark:text-white/40 text-center transition-all duration-300 whitespace-nowrap overflow-hidden mt-4",
              sidebarCollapsed ? "w-0 opacity-0 h-0 mt-0" : "w-auto opacity-100 h-auto"
            )}>
              © 2026 iablee Inc.
            </div>
          </div>
        </div>
      </aside>

      {/* Sidebar drawer for mobile */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setSidebarOpen(false)} />
          <div className="relative flex w-60 flex-col bg-card dark:bg-[#0F172A] shadow-2xl animate-in slide-in-from-left duration-300">
            <div className="flex items-center justify-between p-4 border-b border-border dark:border-white/10">
              <div className="flex items-center gap-3">
                <div className="relative h-12 w-32 overflow-hidden rounded-lg">
                  <Image
                    src="/logo-iablee.png"
                    alt="iablee"
                    fill
                    className="object-contain dark:hidden"
                    unoptimized
                  />
                  <Image
                    src="/logo-iablee-dark.png"
                    alt="iablee"
                    fill
                    className="object-contain hidden dark:block"
                    unoptimized
                  />
                </div>
              </div>
              <button
                onClick={() => setSidebarOpen(false)}
                className="text-muted-foreground hover:text-foreground dark:text-white/70 dark:hover:text-white transition-colors"
                aria-label="Close sidebar"
              >
                &times;
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <Navigation closeSidebar={() => setSidebarOpen(false)} />
            </div>
            {/* Mobile Footer */}
            <div className="p-4 border-t border-border dark:border-white/5 bg-muted/20 dark:bg-black/20">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex items-center gap-3 w-full rounded-lg hover:bg-muted dark:hover:bg-white/5 transition-all p-2 text-left">
                    <div className="relative flex items-center justify-center shrink-0 rounded-full bg-primary/10 dark:bg-white/10 text-primary dark:text-white h-9 w-9">
                      <User className="h-5 w-5" />
                    </div>
                    <div className="flex-1 overflow-hidden">
                      <p className="text-sm font-medium truncate">{t('profile')}</p>
                      <p className="text-xs text-muted-foreground truncate">{t('profileSettings')}</p>
                    </div>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" side="top" sideOffset={10} className="w-56 p-2">
                  <DropdownMenuLabel className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                    {t('profile')}
                  </DropdownMenuLabel>
                  <DropdownMenuItem asChild>
                    <Link href="/settings" className="cursor-pointer flex w-full items-center rounded-md px-2 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground">
                      <User className="mr-2 h-4 w-4 opacity-70" />
                      <span>{t('profileSettings')}</span>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger className="cursor-pointer rounded-md px-2 py-2 text-sm font-medium transition-colors focus:bg-accent focus:text-accent-foreground">
                      <Languages className="mr-2 h-4 w-4 opacity-70" />
                      <span>{t('language')}</span>
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="p-1">
                      <DropdownMenuItem onClick={() => switchLocale('en')} className="cursor-pointer">
                        <span className={locale === 'en' ? 'font-bold text-primary' : ''}>English</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => switchLocale('es')} className="cursor-pointer">
                        <span className={locale === 'es' ? 'font-bold text-primary' : ''}>Español</span>
                      </DropdownMenuItem>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuSeparator className="my-2 bg-border/50" />
                  <DropdownMenuItem onClick={handleSignOut} className="cursor-pointer rounded-md px-2 py-2 text-sm font-medium text-destructive focus:bg-destructive/10 focus:text-destructive">
                    <LogOut className="mr-2 h-4 w-4" />
                    <span>{t('signOut')}</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <div className="text-xs text-muted-foreground dark:text-white/40 text-center mt-4">
                © 2026 iablee Inc.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className={cn(
        "flex-1 flex flex-col transition-all duration-300",
        sidebarCollapsed ? "md:pl-20" : "md:pl-72"
      )}>
        <Navbar onMenuClick={() => setSidebarOpen(true)} />
        <div className="flex-1 p-6 md:p-8 max-w-7xl mx-auto w-full">
          {children}
        </div>
      </main>
      <Toaster richColors closeButton position="top-right" />
    </div>
  );
} 