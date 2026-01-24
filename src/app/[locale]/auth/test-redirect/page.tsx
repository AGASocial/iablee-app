"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale } from 'next-intl';

export default function TestRedirectPage() {
  const router = useRouter();
  const locale = useLocale();

  useEffect(() => {
    console.log('Test redirect page loaded');
    console.log('Current URL:', window.location.href);
    console.log('Locale:', locale);
    console.log('Origin:', window.location.origin);
    
    // Test redirect after 3 seconds
    setTimeout(() => {
      console.log('Redirecting to dashboard...');
      router.push(`/${locale}/dashboard`);
    }, 3000);
  }, [router, locale]);

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center">
        <h1 className="text-2xl font-bold mb-4">Testing Redirect</h1>
        <p className="text-gray-600">This page will redirect to dashboard in 3 seconds...</p>
        <div className="mt-4 p-4 bg-gray-100 rounded">
          <p><strong>Current URL:</strong> {typeof window !== 'undefined' ? window.location.href : 'Loading...'}</p>
          <p><strong>Origin:</strong> {typeof window !== 'undefined' ? window.location.origin : 'Loading...'}</p>
          <p><strong>Locale:</strong> {locale}</p>
        </div>
      </div>
    </div>
  );
} 