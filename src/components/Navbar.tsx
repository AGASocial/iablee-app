'use client';

import Image from 'next/image';
import Link from 'next/link';
import { Menu } from "lucide-react";

export default function Navbar({ onMenuClick }: { onMenuClick?: () => void }) {

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

        {/* Center/Right Section - Empty for now if no other elements */}
        <div className="flex items-center gap-2">
        </div>
      </div>
    </div>
  );
} 