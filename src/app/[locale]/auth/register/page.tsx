"use client";
import { AuthForm } from "@/components/auth/auth-form"
import { AuthHero } from "@/components/auth/auth-hero"
import { useTranslations } from "next-intl"

export default function RegisterPage() {
  const t = useTranslations();
  return (
    <div className="container relative min-h-screen flex-col items-center justify-center grid lg:max-w-none lg:grid-cols-2 lg:px-0">
      {/* Full screen background on mobile, left half on desktop */}
      <AuthHero quote={t('registerQuote')} author="Sofia Davis" />
      <div className="pointer-events-none absolute inset-0 z-20 bg-gradient-to-b from-background/15 via-background/35 to-background/45 dark:from-background/25 dark:via-background/55 dark:to-background/70 lg:left-1/2" />

      {/* Form overlay on mobile, right half on desktop */}
      <div className="relative lg:relative z-30 flex items-center justify-center min-h-screen lg:min-h-0 p-4 sm:p-6 lg:p-8">
        <div className="mx-auto m-4 flex w-full max-w-[420px] flex-col justify-center space-y-6">
          {/* Mobile: Card with backdrop blur for better readability */}
          <div className="rounded-2xl border border-white/45 bg-white/70 p-6 shadow-2xl shadow-black/15 backdrop-blur-xl sm:p-8 dark:border-white/15 dark:bg-card/80 dark:shadow-black/45 lg:border-white/25 lg:bg-white/60 lg:p-8 lg:dark:bg-card/75">
            <AuthForm type="register" />
          </div>
        </div>
      </div>
    </div>
  )
} 