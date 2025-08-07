'use client';
import { ReactNode } from 'react';

export default function WizardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 dark:bg-gray-900 py-8">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8 mx-4 sm:mx-0">
        {children}
      </div>
    </div>
  );
}

