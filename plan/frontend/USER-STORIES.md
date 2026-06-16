# Frontend User Stories — Performance & Scalability

Backlog from [PERFORMANCE-REVIEW.md](../PERFORMANCE-REVIEW.md) (June 2026).  
Default agent: **NextJS Frontend Developer**

---

## US-F-001 — Migrate read-heavy pages to React Server Components

| Field | Value |
|-------|-------|
| **Status** | `DONE` |
| **Priority** | Critical |
| **Phase** | 1 |
| **Source findings** | F-1 |
| **Depends on** | US-B-001 |

### Description

As a **user**, I want dashboard and list pages to load with data already present so that I see content faster and the app makes fewer round-trips under load.

Today 16/19 pages are `'use client'` with post-mount `fetch('/api/*')`, causing blank screens, hydration waterfalls, and double-hop latency (browser → Vercel → Supabase).

### Acceptance criteria

- [ ] Dashboard, digital-assets, and beneficiaries render initial data from the server
- [ ] Interactive filters/modals remain client islands
- [ ] No regression in auth/RLS scoping or security PIN gating
- [ ] LCP improves measurably vs CSR baseline

### Child tasks

| ID | Task | Status |
|----|------|--------|
| T-F-001-1 | Audit dashboard, digital-assets, beneficiaries for RSC candidacy | DONE |
| T-F-001-2 | Create server-side fetch helpers using Supabase server client | DONE |
| T-F-001-3 | Migrate dashboard page to RSC with client islands | DONE |
| T-F-001-4 | Migrate digital-assets list to RSC + client modals island | DONE |
| T-F-001-5 | Migrate beneficiaries list to RSC | DONE |
| T-F-001-6 | Verify LCP and eliminate post-hydration fetch waterfall | DONE |

---

## US-F-002 — Standardize TanStack Query across data layer

| Field | Value |
|-------|-------|
| **Status** | `DONE` |
| **Priority** | High |
| **Phase** | 0 |
| **Source findings** | F-2 |

### Description

As a **developer**, I want a single data-fetching pattern so that duplicate API calls are deduplicated and cache invalidation is consistent.

`QueryProvider` exists with 60s staleTime but only `useAssetTypes` uses it; dashboard, billing, wizard use raw `fetch` + `useState`.

### Acceptance criteria

- [ ] Shared query keys for assets, beneficiaries, dashboard, billing, profile
- [ ] List pages use hooks instead of raw fetch
- [ ] Mutations invalidate related queries
- [ ] Wizard and AddAssetModal use `useAssetTypes` (not imperative duplicate fetches)

### Child tasks

| ID | Task | Status |
|----|------|--------|
| T-F-002-1 | Define shared query keys module | DONE |
| T-F-002-2 | Create useAssets, useBeneficiaries, useDashboard, useBilling hooks | DONE |
| T-F-002-3 | Replace useEffect fetch on digital-assets and beneficiaries pages | DONE |
| T-F-002-4 | Replace billing page and plans page duplicate subscription fetches | DONE |
| T-F-002-5 | Migrate wizard/AddAssetModal to useAssetTypes hooks | DONE |

---

## US-F-003 — Reduce layout and security API fan-out

| Field | Value |
|-------|-------|
| **Status** | `DONE` |
| **Priority** | High |
| **Phase** | 0 |
| **Source findings** | F-3, S-1 |

### Description

As a **user**, I want navigation to feel instant without redundant auth/security checks on every route change.

`SecurityContext` calls `/api/security/check-session` on every `pathname` change. Middleware already runs `getUser()`. `ProtectedRoute` adds another `/api/auth/session`.

### Acceptance criteria

- [ ] check-session not refetched on every pathname change (session-scoped cache or staleTime)
- [ ] ProtectedRoute session fetch removed or merged with security context
- [ ] PIN modal still works after navigation
- [ ] Measurable reduction in API calls per navigation (target: −2 hops)

### Child tasks

| ID | Task | Status |
|----|------|--------|
| T-F-003-1 | Remove pathname dependency from SecurityContext checkStatus effect | DONE |
| T-F-003-2 | Cache check-session result for JWT lifetime client-side | DONE |
| T-F-003-3 | Audit ProtectedRoute vs middleware overlap; remove redundant session fetch | DONE |
| T-F-003-4 | Add React Query wrapper for security session with long staleTime | DONE |
| T-F-003-5 | Verify PIN-gated pages still lock/unlock correctly | DONE |

---

## US-F-004 — Code-split heavy routes and modals

| Field | Value |
|-------|-------|
| **Status** | `DONE` |
| **Priority** | Medium |
| **Phase** | 1 |
| **Source findings** | F-4 |

### Description

As a **user**, I want initial page loads to stay small so that JS parse time does not block interaction on low-end devices.

Stripe (`StripeProvider`), `AddAssetModal`, `AssetDetailsModal`, and `AssetAttachmentsModal` are statically imported. Zero `next/dynamic` usage in codebase.

### Acceptance criteria

- [ ] Stripe loads only when user opens payment method flow
- [ ] Asset modals dynamically imported on digital-assets page
- [ ] Initial route JS bundle reduced on billing and digital-assets
- [ ] No functional regression in modal open flows

### Child tasks

| ID | Task | Status |
|----|------|--------|
| T-F-004-1 | Dynamic import StripeProvider in PaymentMethodsList | DONE |
| T-F-004-2 | Dynamic import asset modals on digital-assets page | DONE |
| T-F-004-3 | Dynamic import wizard heavy steps if applicable | DONE |
| T-F-004-4 | Measure bundle size before/after with build analyzer | DONE |

---

## US-F-005 — Eliminate post-auth API waterfalls

| Field | Value |
|-------|-------|
| **Status** | `DONE` |
| **Priority** | Medium |
| **Phase** | 0 |
| **Source findings** | F-5 |

### Description

As a **user**, I want to reach the dashboard quickly after login without sequential session → assets → redirect chains.

`[locale]/page.tsx` and `auth-form.tsx` fetch session then assets sequentially before redirect.

### Acceptance criteria

- [ ] Login redirect uses middleware/wizard logic without extra assets fetch where possible
- [ ] Locale home page avoids sequential session + assets waterfall
- [ ] Redirect target (wizard vs dashboard) determined in ≤1 API round-trip

### Child tasks

| ID | Task | Status |
|----|------|--------|
| T-F-005-1 | Audit login and locale redirect flows | DONE |
| T-F-005-2 | Use middleware redirect rules or combined endpoint for post-auth routing | DONE |
| T-F-005-3 | Remove redundant assets fetch on auth-form success path | DONE |
| T-F-005-4 | Add E2E timing assertion for login → dashboard | DONE |

---

## US-F-006 — Parallelize wizard file uploads

| Field | Value |
|-------|-------|
| **Status** | `DONE` |
| **Priority** | Medium |
| **Phase** | 2 |
| **Source findings** | B-4 |
| **Handoffs** | Backend may add batch upload endpoint |

### Description

As a **new user**, I want wizard completion to upload multiple files in parallel so that onboarding does not timeout with many attachments.

Wizard uses sequential `for...await fetch('/api/storage/upload')` — N files = N round-trips.

### Acceptance criteria

- [ ] Multiple files upload via `Promise.all` or single batch endpoint
- [ ] Progress UI reflects parallel upload state
- [ ] Failure of one file does not silently drop others
- [ ] Wizard complete API called only after all uploads succeed

### Child tasks

| ID | Task | Status |
|----|------|--------|
| T-F-006-1 | Replace sequential upload loop with Promise.all | DONE |
| T-F-006-2 | Add per-file error handling and retry UI | DONE |
| T-F-006-3 | Cap concurrent uploads (e.g. 3) to avoid browser connection limit | DONE |

---

## US-F-007 — Dedupe i18n providers and remove dead dependencies

| Field | Value |
|-------|-------|
| **Status** | `DONE` |
| **Priority** | Low |
| **Phase** | 0 |
| **Source findings** | F-6, L-1 |

### Description

As a **developer**, I want a lean dependency tree and single i18n provider per subtree so that hydration and bundle size are minimized.

Dashboard layout re-wraps `NextIntlClientProvider` and re-imports messages. `framer-motion` is in package.json with zero imports.

### Acceptance criteria

- [ ] Single NextIntlClientProvider for dashboard subtree
- [ ] framer-motion removed from dependencies if unused
- [ ] settings/page.tsx client/server boundary fixed (useTranslations)

### Child tasks

| ID | Task | Status |
|----|------|--------|
| T-F-007-1 | Remove duplicate NextIntlClientProvider from dashboard layout | DONE |
| T-F-007-2 | Remove unused framer-motion dependency | DONE |
| T-F-007-3 | Fix settings page RSC/client boundary | DONE |

---

## US-F-008 — Consolidate duplicate profile fetches on settings

| Field | Value |
|-------|-------|
| **Status** | `DONE` |
| **Priority** | Low |
| **Phase** | 0 |
| **Source findings** | F-2 |

### Description

As a **user**, I want settings pages to load without duplicate `/api/user/profile` calls from ProfileForm and ChangePasswordCard mounting together.

### Acceptance criteria

- [ ] Single profile query shared via React Query or lifted state
- [ ] Security settings page loads with one profile API call

### Child tasks

| ID | Task | Status |
|----|------|--------|
| T-F-008-1 | Create useUserProfile hook | DONE |
| T-F-008-2 | Refactor ProfileForm and ChangePasswordCard to share hook | DONE |
