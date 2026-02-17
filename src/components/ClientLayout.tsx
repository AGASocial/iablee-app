"use client";

import LayoutWrapper from "@/components/LayoutWrapper";
import { SecurityProvider } from '@/context/SecurityContext';

export default function ClientLayout({ children }: { children: React.ReactNode }) {
    return (
        <SecurityProvider>
            <LayoutWrapper>
                {children}
            </LayoutWrapper>
        </SecurityProvider>
    );
}