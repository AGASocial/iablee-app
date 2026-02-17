"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

export default function AuthCallbackPage() {
  const searchParams = useSearchParams();

  useEffect(() => {
    const qs = searchParams.toString();
    const target = qs ? `/api/auth/callback?${qs}` : '/api/auth/callback';
    window.location.replace(target);
  }, [searchParams]);

  return (
    <div className="flex items-center justify-center min-h-screen">
      <span>Signing you in...</span>
    </div>
  );
}
