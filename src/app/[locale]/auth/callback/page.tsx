"use client";
import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useLocale } from "next-intl";

export default function AuthCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const locale = useLocale();

  useEffect(() => {
    async function handleAuth() {
      try {
        // Supabase JS client will automatically handle the session if the code is present
        // But you can force a refresh or handle errors here if needed
        const { data: { session }, error } = await supabase.auth.getSession();
        
        if (!error && session) {
          // Check if user has any assets
          const { data: assets, error: assetsError } = await supabase
            .from('digital_assets')
            .select('id')
            .eq('user_id', session.user.id)
            .limit(1);

          if (assetsError) {
            console.error('Error checking assets:', assetsError);
            router.replace(`/${locale}/dashboard`);
            return;
          }

          // If user has no assets, redirect to wizard
          if (!assets || assets.length === 0) {
            router.replace(`/${locale}/wizard`);
          } else {
            router.replace(`/${locale}/dashboard`);
          }
        } else {
          // Handle error (show message, redirect, etc.)
          console.error('Auth callback error:', error);
          router.replace(`/${locale}/auth/login`);
        }
      } catch (error) {
        console.error('Auth callback error:', error);
        router.replace(`/${locale}/auth/login`);
      }
    }
    handleAuth();
  }, [router, searchParams, locale]);

  return (
    <div className="flex items-center justify-center min-h-screen">
      <span>Signing you in...</span>
    </div>
  );
} 