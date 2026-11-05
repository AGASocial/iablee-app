'use client';
import { ReactNode } from 'react';

export default function WizardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center py-8">
      <div className="bg-card rounded-lg shadow-lg p-8 mx-4 sm:mx-0 border border-border">
        {children}
      </div>
    </div>
  );
}

