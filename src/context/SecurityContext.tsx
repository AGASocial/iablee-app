"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { usePathname } from 'next/navigation';

interface SecurityState {
    hasPin: boolean;
    locked: boolean;
    loading: boolean;
    checkStatus: () => Promise<void>;
}

const SecurityContext = createContext<SecurityState | undefined>(undefined);

export function SecurityProvider({ children }: { children: React.ReactNode }) {
    const [state, setState] = useState<{
        hasPin: boolean;
        locked: boolean;
        loading: boolean;
    }>({
        hasPin: false,
        locked: true,
        loading: true,
    });
    const pathname = usePathname();

    const checkStatus = useCallback(async () => {
        try {
            const res = await fetch("/api/security/check-session");
            if (res.ok) {
                const data = await res.json();
                // data: { authenticated, hasPin, locked }
                if (data.authenticated) {
                    setState({
                        hasPin: data.hasPin,
                        locked: data.locked,
                        loading: false
                    });
                } else {
                    // Not authenticated, irrelevant
                    setState({ hasPin: false, locked: false, loading: false });
                }
            } else {
                setState(prev => ({ ...prev, loading: false }));
            }
        } catch (error) {
            console.error("Failed to check security status", error);
            setState(prev => ({ ...prev, loading: false }));
        }
    }, []);

    useEffect(() => {
        // eslint-disable-next-line
        checkStatus();
    }, [checkStatus, pathname]);

    return (
        <SecurityContext.Provider value={{ ...state, checkStatus }}>
            {children}
        </SecurityContext.Provider>
    );
}

export function useSecurity() {
    const context = useContext(SecurityContext);
    if (context === undefined) {
        throw new Error('useSecurity must be used within a SecurityProvider');
    }
    return context;
}
