"use client";
import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function AuthCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    async function handleAuth() {
      // Supabase JS client will automatically handle the session if the code is present
      // But you can force a refresh or handle errors here if needed
      const { error } = await supabase.auth.getSession();
      if (!error) {
        router.replace("/dashboard");
      } else {
        // Handle error (show message, redirect, etc.)
        router.replace("/auth/login");
      }
    }
    handleAuth();
  }, [router, searchParams]);

  return (
    <div className="flex items-center justify-center min-h-screen">
      <span>Signing you in...</span>
    </div>
  );
} 