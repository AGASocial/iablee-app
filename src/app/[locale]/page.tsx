"use client";

import { useEffect } from 'react';
import { useRouter } from '@/i18n/navigation';
import { supabase } from '@/lib/supabase';

export default function LocalePage() {
  const router = useRouter();

  useEffect(() => {
    const checkSessionAndRedirect = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        router.replace('/dashboard');
      } else {
        router.replace('/auth/login');
      }
    };

    checkSessionAndRedirect();
  }, [router]);

  return <div>Loading...</div>;
} 