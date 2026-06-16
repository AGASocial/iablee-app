"use client";

import React, { createContext, useContext, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSecuritySession } from '@/hooks/useDataQueries';
import { queryKeys } from '@/lib/query-keys';

interface SecurityState {
    hasPin: boolean;
    locked: boolean;
    loading: boolean;
    checkStatus: () => Promise<void>;
}

const SecurityContext = createContext<SecurityState | undefined>(undefined);

export function SecurityProvider({ children }: { children: React.ReactNode }) {
    const queryClient = useQueryClient();
    const { data, isLoading, refetch } = useSecuritySession();

    const checkStatus = useCallback(async () => {
        await queryClient.invalidateQueries({ queryKey: queryKeys.security.session() });
        await refetch();
    }, [queryClient, refetch]);

    const state: SecurityState = {
        hasPin: data?.hasPin ?? false,
        locked: data?.locked ?? true,
        loading: isLoading,
        checkStatus,
    };

    return (
        <SecurityContext.Provider value={state}>
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
