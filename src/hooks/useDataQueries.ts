import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import type { Asset } from '@/models/asset';
import type { Beneficiary } from '@/models/beneficiary';
import type { PaginatedResponse } from '@/lib/pagination';

async function fetchAssets(cursor?: string | null): Promise<PaginatedResponse<Asset>> {
  const params = new URLSearchParams({ limit: '100' });
  if (cursor) params.set('cursor', cursor);
  const res = await fetch(`/api/assets?${params}`);
  if (!res.ok) throw new Error('Failed to fetch assets');
  return res.json();
}

async function fetchAllAssets(): Promise<Asset[]> {
  const first = await fetchAssets();
  let all = [...first.data];
  let nextCursor = first.pagination.nextCursor;
  while (nextCursor) {
    const page = await fetchAssets(nextCursor);
    all = all.concat(page.data);
    nextCursor = page.pagination.nextCursor;
  }
  return all;
}

export function useAssets(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.assets.list(),
    queryFn: fetchAllAssets,
    staleTime: 60 * 1000,
    enabled: options?.enabled ?? true,
  });
}

async function fetchBeneficiaries(cursor?: string | null): Promise<PaginatedResponse<Beneficiary>> {
  const params = new URLSearchParams({ limit: '100' });
  if (cursor) params.set('cursor', cursor);
  const res = await fetch(`/api/beneficiaries?${params}`);
  if (!res.ok) throw new Error('Failed to fetch beneficiaries');
  return res.json();
}

async function fetchAllBeneficiaries(): Promise<Beneficiary[]> {
  const first = await fetchBeneficiaries();
  let all = [...first.data];
  let nextCursor = first.pagination.nextCursor;
  while (nextCursor) {
    const page = await fetchBeneficiaries(nextCursor);
    all = all.concat(page.data);
    nextCursor = page.pagination.nextCursor;
  }
  return all;
}

export function useBeneficiaries(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.beneficiaries.list(),
    queryFn: fetchAllBeneficiaries,
    staleTime: 60 * 1000,
    enabled: options?.enabled ?? true,
  });
}

export interface DashboardData {
  assets: Asset[];
  beneficiaries: Beneficiary[];
  stats: {
    totalAssets: number;
    totalBeneficiaries: number;
    protectedAssets: number;
    recentActivity: number;
  };
}

async function fetchDashboard(): Promise<DashboardData> {
  const res = await fetch('/api/dashboard');
  if (!res.ok) throw new Error('Failed to fetch dashboard');
  return res.json();
}

export function useDashboard(
  options?: { enabled?: boolean; initialData?: DashboardData }
) {
  return useQuery({
    queryKey: queryKeys.dashboard.summary(),
    queryFn: fetchDashboard,
    staleTime: 60 * 1000,
    enabled: options?.enabled ?? true,
    initialData: options?.initialData,
  });
}

interface SubscriptionStatus {
  hasSubscription: boolean;
  status?: string;
  planName?: string;
  limits: {
    maxAssets: number;
    maxBeneficiaries: number;
    maxStorageMb: number;
    maxFileSizeMb: number;
  };
  usage: {
    assetsCount: number;
    beneficiariesCount: number;
    storageUsedMb: number;
  };
}

async function fetchSubscriptionStatus(): Promise<SubscriptionStatus> {
  const res = await fetch('/api/subscription/status');
  if (!res.ok) throw new Error('Failed to fetch subscription status');
  return res.json();
}

export function useBilling(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.billing.subscription(),
    queryFn: fetchSubscriptionStatus,
    staleTime: 5 * 60 * 1000,
    enabled: options?.enabled ?? true,
  });
}

interface SecuritySession {
  authenticated: boolean;
  hasPin: boolean;
  locked: boolean;
}

async function fetchSecuritySession(): Promise<SecuritySession> {
  const res = await fetch('/api/security/check-session');
  if (!res.ok) throw new Error('Failed to check security session');
  return res.json();
}

/** 15 min staleTime matches security session JWT lifetime */
export function useSecuritySession(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.security.session(),
    queryFn: fetchSecuritySession,
    staleTime: 15 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    enabled: options?.enabled ?? true,
  });
}

interface UserProfile {
  id: string;
  email: string;
  full_name: string | null;
  identities?: { provider: string }[];
}

async function fetchUserProfile(): Promise<UserProfile> {
  const res = await fetch('/api/user/profile');
  if (!res.ok) throw new Error('Failed to fetch profile');
  return res.json();
}

export function useUserProfile(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.profile.detail(),
    queryFn: fetchUserProfile,
    staleTime: 5 * 60 * 1000,
    enabled: options?.enabled ?? true,
  });
}

export function useInvalidateData() {
  const queryClient = useQueryClient();
  return {
    invalidateAssets: () => queryClient.invalidateQueries({ queryKey: queryKeys.assets.all }),
    invalidateBeneficiaries: () => queryClient.invalidateQueries({ queryKey: queryKeys.beneficiaries.all }),
    invalidateDashboard: () => queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all }),
    invalidateBilling: () => queryClient.invalidateQueries({ queryKey: queryKeys.billing.all }),
    invalidateSecurity: () => queryClient.invalidateQueries({ queryKey: queryKeys.security.all }),
    invalidateProfile: () => queryClient.invalidateQueries({ queryKey: queryKeys.profile.all }),
  };
}
