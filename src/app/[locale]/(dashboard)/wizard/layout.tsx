'use client';
import { ReactNode } from 'react';

export default function WizardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="w-full">{children}</div>
  );
}

