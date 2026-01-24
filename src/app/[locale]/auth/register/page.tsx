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
      
      {/* Form overlay on mobile, right half on desktop */}
      <div className="relative lg:relative z-30 flex items-center justify-center min-h-screen lg:min-h-0 p-4 sm:p-6 lg:p-8">
        <div className="mx-auto flex w-full flex-col justify-center space-y-6 sm:w-[350px]">
          {/* Mobile: Card with backdrop blur for better readability */}
          <div className="lg:bg-transparent bg-white/95 dark:bg-background/95 backdrop-blur-md rounded-xl lg:rounded-none p-6 sm:p-8 lg:p-0 shadow-xl lg:shadow-none border border-border/50 lg:border-0">
            <AuthForm type="register" />
          </div>
        </div>
      </div>
    </div>
  )
} 