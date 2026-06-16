/**
 * Shared TanStack Query keys for the data layer.
 */
export const queryKeys = {
  assets: {
    all: ['assets'] as const,
    list: (cursor?: string | null) => [...queryKeys.assets.all, 'list', cursor ?? 'initial'] as const,
  },
  beneficiaries: {
    all: ['beneficiaries'] as const,
    list: (cursor?: string | null) => [...queryKeys.beneficiaries.all, 'list', cursor ?? 'initial'] as const,
  },
  dashboard: {
    all: ['dashboard'] as const,
    summary: () => [...queryKeys.dashboard.all, 'summary'] as const,
  },
  billing: {
    all: ['billing'] as const,
    subscription: () => [...queryKeys.billing.all, 'subscription'] as const,
    plans: () => [...queryKeys.billing.all, 'plans'] as const,
  },
  security: {
    all: ['security'] as const,
    session: () => [...queryKeys.security.all, 'session'] as const,
  },
  profile: {
    all: ['profile'] as const,
    detail: () => [...queryKeys.profile.all, 'detail'] as const,
  },
  assetTypes: {
    all: ['asset-types'] as const,
    list: () => [...queryKeys.assetTypes.all, 'list'] as const,
    detail: (key: string) => [...queryKeys.assetTypes.all, key] as const,
  },
} as const;
