'use client';

import { useTranslations } from 'next-intl';
import Image from 'next/image';
import Link from 'next/link';
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
import { Button } from "@/components/ui/button";
import { User, LogOut, Languages, Menu } from "lucide-react";
import { useRouter, usePathname } from '@/i18n/navigation';
import { useLocale } from 'next-intl';
import { supabase } from '@/lib/supabase';

export default function Navbar({ onMenuClick }: { onMenuClick?: () => void }) {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const locale = useLocale();

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/auth/login');
  };

  const switchLocale = (newLocale: string) => {
    router.replace(pathname, { locale: newLocale });
  };

  return (
    <div className="sticky top-0 z-40 w-full border-b border-white/10 bg-white/60 backdrop-blur-xl transition-all dark:bg-black/40 supports-[backdrop-filter]:bg-white/60">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-4">
          {onMenuClick && (
            <button
              className="group flex items-center justify-center rounded-lg p-2 text-foreground/70 hover:bg-accent hover:text-foreground md:hidden transition-colors"
              onClick={onMenuClick}
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5 transition-transform group-active:scale-95" />
            </button>
          )}

          {/* Logo Section */}
          <Link href="/dashboard" className="flex md:hidden items-center gap-2 transition-opacity hover:opacity-90">
            <div className="relative h-16 w-32 overflow-hidden rounded-lg">
              <Image
                src="/logo-iablee.png"
                alt="iablee"
                fill
                className="object-contain dark:hidden"
                priority
                unoptimized
              />
              <Image
                src="/logo-iablee-dark.png"
                alt="iablee"
                fill
                className="object-contain hidden dark:block"
                priority
                unoptimized
              />
            </div>
          </Link>
        </div>

        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-9 w-9 p-0 rounded-full border border-transparent hover:border-border hover:bg-secondary/50 transition-all">
                <User className="h-4 w-4 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 p-2">
              <DropdownMenuLabel className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                {t('profile')}
              </DropdownMenuLabel>
              <DropdownMenuItem className="cursor-pointer rounded-md px-2 py-2 text-sm font-medium transition-colors focus:bg-accent focus:text-accent-foreground">
                <User className="mr-2 h-4 w-4 opacity-70" />
                <span>{t('profileSettings')}</span>
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
        </div>
      </div>
    </div>
  );
} 