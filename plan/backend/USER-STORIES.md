# Backend User Stories — Performance & Scalability

Backlog from [PERFORMANCE-REVIEW.md](../PERFORMANCE-REVIEW.md) (June 2026).  
Default agent: **NextJS Backend Developer**

---

## US-B-001 — Cursor pagination on list endpoints

| Field | Value |
|-------|-------|
| **Status** | `PENDING` |
| **Priority** | Critical |
| **Phase** | 0 |
| **Source findings** | B-1 |
| **Handoffs** | T-B-001-5 updates frontend list UI |

### Description

As the **platform**, I want paginated list APIs so that asset and beneficiary responses stay bounded as users scale their vaults.

`GET /api/assets` fetches all rows from `decrypted_digital_assets` with full decrypt. `GET /api/beneficiaries` has no limit.

### Acceptance criteria

- [ ] Assets list supports `limit`, `cursor`, `hasMore`, `nextCursor`
- [ ] Beneficiaries list supports same pagination contract
- [ ] List view excludes heavy decrypted fields where possible (detail on GET by id)
- [ ] Frontend handoff documented for infinite scroll or page controls

### Child tasks

| ID | Task | Status |
|----|------|--------|
| T-B-001-1 | Design pagination response shape shared across list endpoints | PENDING |
| T-B-001-2 | Implement cursor pagination on GET /api/assets | PENDING |
| T-B-001-3 | Split list vs detail select (no decrypted_password in list) | PENDING |
| T-B-001-4 | Implement cursor pagination on GET /api/beneficiaries | PENDING |
| T-B-001-5 | Document frontend integration contract in API comments | PENDING |

---

## US-B-002 — Consolidate subscription status queries

| Field | Value |
|-------|-------|
| **Status** | `PENDING` |
| **Priority** | Critical |
| **Phase** | 0 |
| **Source findings** | B-3 |

### Description

As the **platform**, I want subscription status resolved in minimal DB round-trips so that billing UI and limit checks do not amplify load.

`getSubscriptionStatus()` re-queries subscription inside `getSubscriptionLimits()` plus separate usage counts — 4–5 round-trips per call.

### Acceptance criteria

- [ ] Single subscription + plan fetch per request
- [ ] Usage counts fetched in parallel once
- [ ] `/api/subscription/status` and `/api/subscription/check-limit` share helper
- [ ] No duplicate service-role client creation in status route

### Child tasks

| ID | Task | Status |
|----|------|--------|
| T-B-002-1 | Refactor limits.ts to single-query subscription status | PENDING |
| T-B-002-2 | Reuse supabaseAdmin singleton in subscription/status route | PENDING |
| T-B-002-3 | Add route test asserting ≤2 DB query groups | PENDING |
| T-B-002-4 | Cache subscription status in-memory per request context | PENDING |

---

## US-B-003 — Rate limiting on auth and security routes

| Field | Value |
|-------|-------|
| **Status** | `PENDING` |
| **Priority** | Critical |
| **Phase** | 0 |
| **Source findings** | B-2, S-1 |

### Description

As the **platform**, I want rate limits on authentication and PIN endpoints so that brute-force and DoS attacks cannot exhaust serverless concurrency.

No application-level rate limiting exists. PIN verify uses bcrypt with no lockout.

### Acceptance criteria

- [ ] Rate limit login, register, verify-pin, forgot-pin by IP + user key
- [ ] Return 429 with Retry-After header
- [ ] PIN lockout after N failures (configurable)
- [ ] Upload route rate limited by user

### Child tasks

| ID | Task | Status |
|----|------|--------|
| T-B-003-1 | Add rate limit utility (KV, Upstash, or in-memory for dev) | PENDING |
| T-B-003-2 | Apply limits to auth/login, auth/register | PENDING |
| T-B-003-3 | Apply limits to security/verify-pin and forgot-pin | PENDING |
| T-B-003-4 | Apply limits to storage/upload | PENDING |
| T-B-003-5 | Add lockout counter on users or security_otps table | PENDING |

---

## US-B-004 — Cache reference data API responses

| Field | Value |
|-------|-------|
| **Status** | `PENDING` |
| **Priority** | High |
| **Phase** | 1 |
| **Source findings** | B-9, N-1 |

### Description

As the **platform**, I want rarely-changing data cached at the edge so that plans, relationships, and asset-types do not hit Postgres on every page load.

`GET /api/billing/plans`, `/api/relationships`, `/api/asset-types` return no Cache-Control headers.

### Acceptance criteria

- [ ] Cache-Control on reference GET endpoints (s-maxage=3600 or stale-while-revalidate)
- [ ] asset-types 3-query chain reduced or cached
- [ ] Invalidation strategy documented for plan changes

### Child tasks

| ID | Task | Status |
|----|------|--------|
| T-B-004-1 | Add Cache-Control to GET /api/billing/plans | PENDING |
| T-B-004-2 | Add Cache-Control to GET /api/relationships | PENDING |
| T-B-004-3 | Consolidate asset-types queries; add caching layer | PENDING |
| T-B-004-4 | Consider unstable_cache or edge config for hot reads | PENDING |

---

## US-B-005 — Billing service client singleton

| Field | Value |
|-------|-------|
| **Status** | `PENDING` |
| **Priority** | High |
| **Phase** | 0 |
| **Source findings** | B-7 |

### Description

As a **developer**, I want a reused Supabase service client for billing so that every billing route does not allocate a new client.

`getBillingService()` calls `createClient()` on every invocation.

### Acceptance criteria

- [ ] Single billing admin client module reused across routes
- [ ] billing/plans and subscription/status use shared client
- [ ] No behavior change in billing flows

### Child tasks

| ID | Task | Status |
|----|------|--------|
| T-B-005-1 | Refactor getBillingService to module singleton | PENDING |
| T-B-005-2 | Replace inline createClient in plans and status routes | PENDING |
| T-B-005-3 | Verify webhook handlers use same client | PENDING |

---

## US-B-006 — Upload size limits and stream-only path

| Field | Value |
|-------|-------|
| **Status** | `PENDING` |
| **Priority** | High |
| **Phase** | 1 |
| **Source findings** | B-5 |

### Description

As the **platform**, I want uploads bounded and streamed so that large files cannot OOM serverless functions or bypass plan quotas.

Upload route has no max size; falls back to `arrayBuffer()` full-buffer path. Storage usage hardcoded to 0 in limits.

### Acceptance criteria

- [ ] Server-side max file size enforced per plan tier
- [ ] Remove or guard arrayBuffer fallback
- [ ] Accurate storage metering for billing limits
- [ ] Reduce pre-upload DB round-trips (cache encrypted_storage_key per session)

### Child tasks

| ID | Task | Status |
|----|------|--------|
| T-B-006-1 | Enforce max upload bytes from subscription limits | PENDING |
| T-B-006-2 | Eliminate full-buffer fallback; reject non-stream uploads | PENDING |
| T-B-006-3 | Implement storage usage aggregation for getUsageStats | PENDING |
| T-B-006-4 | Cache user encryption key lookup within request | PENDING |

---

## US-B-007 — Async webhook processing

| Field | Value |
|-------|-------|
| **Status** | `PENDING` |
| **Priority** | High |
| **Phase** | 2 |
| **Source findings** | B-6 |

### Description

As the **billing system**, I want webhooks acknowledged quickly and processed asynchronously so that Stripe/PayU retries do not pile up under DB slowness.

Stripe and PayU handlers process synchronously in the request thread.

### Acceptance criteria

- [ ] Webhook validates signature, enqueues event, returns 200 quickly
- [ ] Idempotent processing keyed by event ID (billing_webhook_events)
- [ ] Failed processing retried with dead-letter logging
- [ ] Document queue choice (Supabase table + cron, Inngest, etc.)

### Child tasks

| ID | Task | Status |
|----|------|--------|
| T-B-007-1 | Design webhook queue schema or use billing_webhook_events | PENDING |
| T-B-007-2 | Refactor Stripe handler to enqueue-then-process | PENDING |
| T-B-007-3 | Refactor PayU handler similarly | PENDING |
| T-B-007-4 | Add monitoring for queue lag | PENDING |

---

## US-B-008 — Fix dashboard aggregate stats

| Field | Value |
|-------|-------|
| **Status** | `PENDING` |
| **Priority** | Medium |
| **Phase** | 0 |
| **Source findings** | B-8 |

### Description

As a **user**, I want dashboard totals to reflect my full vault, not just the first 5 rows, without fetching unbounded data.

`GET /api/dashboard` uses `.limit(5)` but computes totals from those rows.

### Acceptance criteria

- [ ] totalAssets and totalBeneficiaries use COUNT queries
- [ ] Recent items still limited to 5 for display
- [ ] Response time stays bounded

### Child tasks

| ID | Task | Status |
|----|------|--------|
| T-B-008-1 | Add count queries parallel to limited list fetch | PENDING |
| T-B-008-2 | Update dashboard response shape if needed | PENDING |
| T-B-008-3 | Add route test for correct totals with >5 records | PENDING |

---

## US-B-009 — Single-pass auth validation in API handlers

| Field | Value |
|-------|-------|
| **Status** | `PENDING` |
| **Priority** | High |
| **Phase** | 1 |
| **Source findings** | F-3, S-1 |

### Description

As the **platform**, I want each API handler to validate auth once and reuse context so that assets/beneficiaries routes do not chain getUser + checkSecuritySession + pin lookup.

### Acceptance criteria

- [ ] Shared request context helper returns user + security session state
- [ ] Assets and beneficiaries routes use single helper
- [ ] Redundant security_pin_hash queries removed on happy path

### Child tasks

| ID | Task | Status |
|----|------|--------|
| T-B-009-1 | Create getAuthenticatedContext() combining auth + security | PENDING |
| T-B-009-2 | Refactor assets and beneficiaries routes | PENDING |
| T-B-009-3 | Refactor check-session to reuse same helper server-side | PENDING |
| T-B-009-4 | Benchmark handler latency before/after | PENDING |

---

## US-B-010 — Database indexes and RLS hardening

| Field | Value |
|-------|-------|
| **Status** | `PENDING` |
| **Priority** | Critical |
| **Phase** | 0 |
| **Source findings** | D-1, D-2, D-3 |

### Description

As the **platform**, I want indexed tenant columns and hardened OTP security so that Postgres does not full-scan under RLS and concurrent load.

Missing indexes on `digital_assets.user_id`, `beneficiaries.user_id`, `asset_attachments.asset_id`. `security_otps` has no RLS or indexes.

### Acceptance criteria

- [ ] Migration adds composite indexes on tenant FK columns
- [ ] Index on billing_subscriptions (user_id, status)
- [ ] security_otps: RLS, index on (user_id, verified, expires_at), cleanup job
- [ ] users UPDATE RLS policy for PIN columns
- [ ] asset_attachments RLS optimized (EXISTS vs IN subquery)

### Child tasks

| ID | Task | Status |
|----|------|--------|
| T-B-010-1 | Migration: indexes on digital_assets, beneficiaries, asset_attachments | PENDING |
| T-B-010-2 | Migration: billing_subscriptions (user_id, status) index | PENDING |
| T-B-010-3 | Migration: security_otps RLS + indexes + expiry cleanup | PENDING |
| T-B-010-4 | Migration: users UPDATE policy for security_pin columns | PENDING |
| T-B-010-5 | Optimize asset_attachments RLS policies | PENDING |
| T-B-010-6 | Version-control missing columns (encrypted_storage_key, pin hash) in migrations | PENDING |

---

## US-B-011 — Production observability instrumentation

| Field | Value |
|-------|-------|
| **Status** | `PENDING` |
| **Priority** | High |
| **Phase** | 2 |
| **Source findings** | (monitoring gap) |

### Description

As an **operator**, I want request duration and error logging on hot paths so that we can detect regressions before users do.

### Acceptance criteria

- [ ] Structured logging on API routes with route name and duration_ms
- [ ] Slow query threshold logged (>500ms)
- [ ] Vercel Observability or equivalent wired for production
- [ ] Document dashboards/alerts in plan or docs

### Child tasks

| ID | Task | Status |
|----|------|--------|
| T-B-011-1 | Add withTiming wrapper for route handlers | PENDING |
| T-B-011-2 | Instrument top 10 hot routes (assets, check-session, dashboard) | PENDING |
| T-B-011-3 | Configure Vercel log drain or APM integration | PENDING |
| T-B-011-4 | Document alert thresholds in PERFORMANCE-REVIEW.md | PENDING |
