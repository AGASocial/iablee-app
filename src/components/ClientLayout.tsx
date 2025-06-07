"use client";

import { ThemeProvider } from "@/components/theme-provider";
import LayoutWrapper from "@/components/LayoutWrapper";

export default function ClientLayout({ children }: { children: React.ReactNode }) {
    return (
        <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
        >
            <LayoutWrapper>
                {children}
            </LayoutWrapper>
        </ThemeProvider>
    );
} 