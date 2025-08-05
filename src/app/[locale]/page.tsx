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
        // Check if user has any assets
        const { data: assets, error: assetsError } = await supabase
          .from('digital_assets')
          .select('id')
          .eq('user_id', session.user.id)
          .limit(1);

        if (assetsError) {
          console.error('Error checking assets:', assetsError);
          router.replace('/dashboard');
          return;
        }

        // If user has no assets, redirect to wizard
        if (!assets || assets.length === 0) {
          router.replace('/wizard');
        } else {
          router.replace('/dashboard');
        }
      } else {
        router.replace('/auth/login');
      }
    };

    checkSessionAndRedirect();
  }, [router]);

  return <div>Loading...</div>;
} 