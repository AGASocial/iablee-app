"use client";

import LayoutWrapper from "@/components/LayoutWrapper";

export default function ClientLayout({ children }: { children: React.ReactNode }) {
    return (
        <LayoutWrapper>
            {children}
        </LayoutWrapper>
    );
}