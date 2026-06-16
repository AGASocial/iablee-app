# Performance & Scalability Review — iablee-app

**Date:** June 2026  
**Goal:** Support **10,000+ concurrent users** without degradation  
**Scope:** Next.js 16 frontend, 35 API routes, Supabase (Postgres + Auth + Storage)

---

## Scalability Readiness Score: **34 / 100**

| Dimension | Score | Notes |
|-----------|-------|-------|
| Frontend rendering | 25 | 16/19 pages are CSR; no RSC data fetching |
| API design | 30 | Unbounded lists, no pagination, duplicate queries |
| Database | 40 | Missing indexes on core tenant tables |
| Caching | 15 | Almost no Cache-Control; no edge cache |
| Security vs perf | 35 | check-session on every navigation; bcrypt without rate limits |
| Observability | 20 | No structured APM, no load baseline |
| Resilience | 25 | No rate limits, no circuit breakers, sync webhooks |

---

## Bottleneck Report (ranked by risk)

| Rank | ID | Severity | Issue | Scalability risk |
|------|-----|----------|-------|------------------|
| 1 | B-1 | **Critical** | `GET /api/assets` returns unbounded decrypted rows via service role | O(n) CPU decrypt + memory; collapses at ~500 heavy users |
| 2 | F-1 | **Critical** | All dashboard pages CSR + post-mount fetch waterfalls | 2–4 API hops before first content; poor LCP at scale |
| 3 | S-1 | **Critical** | `check-session` fires on every pathname change (Auth + DB) | 2× Supabase calls per navigation × concurrent users |
| 4 | B-2 | **Critical** | No rate limiting on login, PIN verify, upload | Brute-force and DoS vector; serverless concurrency exhaustion |
| 5 | D-1 | **Critical** | Missing indexes on `digital_assets.user_id`, `beneficiaries.user_id`, `asset_attachments.asset_id` | Full table scans under RLS subqueries |
| 6 | B-3 | **High** | `getSubscriptionStatus` duplicates 4–5 DB round-trips | Hot path for billing UI and limit checks |
| 7 | F-2 | **High** | TanStack Query installed but unused (except asset types) | Duplicate fetches across pages; no dedup |
| 8 | B-4 | **High** | Sequential wizard file uploads (N round-trips) | Onboarding timeout under load |
| 9 | B-5 | **High** | Storage upload: 2–3 DB calls before stream; no size cap | Latency floor + memory spike via arrayBuffer fallback |
| 10 | B-6 | **High** | Sync Stripe/PayU webhook processing | Blocks serverless; retry storms on slow DB |
| 11 | F-3 | **High** | Middleware getUser + ProtectedRoute session + SecurityContext | Triple auth fan-out on protected pages |
| 12 | D-2 | **High** | `security_otps` no RLS, no indexes, plaintext codes | Security + scan cost at scale |
| 13 | B-7 | **Medium** | `getBillingService()` creates new Supabase client per call | Allocation churn; harder to optimize connections |
| 14 | F-4 | **Medium** | Stripe + heavy modals eagerly imported (no dynamic) | Large initial JS on billing/assets routes |
| 15 | B-8 | **Medium** | Dashboard stats computed from `.limit(5)` rows | Wrong data + wasted refetch patterns |
| 16 | B-9 | **Medium** | Reference data (plans, relationships, asset-types) uncached | Repeatable DB load on every page visit |
| 17 | D-3 | **Medium** | `asset_attachments` RLS uses correlated subquery | Per-row policy cost grows with attachments |
| 18 | F-5 | **Medium** | Post-login waterfall: session → assets → redirect | Adds 200–400ms to every login |
| 19 | N-1 | **Medium** | No CDN cache headers on static API responses | Edge misses; origin load |
| 20 | L-1 | **Low** | Dead `framer-motion` dependency | Bundle bloat |
| 21 | F-6 | **Low** | Duplicate NextIntlClientProvider in dashboard layout | Redundant message bundle work |

---

## Load behavior estimates

| Concurrent users | Expected behavior | Failure points |
|------------------|-------------------|----------------|
| **1,000** | Elevated p95 latency (800ms–2s on assets list); occasional 504 on upload | Unbounded asset GET; check-session storm |
| **5,000** | Auth API rate limits; Postgres CPU from decrypt view | Supabase Auth saturation; missing indexes |
| **10,000** | Widespread timeouts; cascading 503s on Vercel | Serverless concurrency + sync webhooks + no rate limits |
| **50,000** | Service outage without architectural changes | All of the above + connection/API limits |

---

## Performance Optimization Roadmap

### Phase 0 — Quick wins (score 34 → ~52)
- Add cursor pagination to assets/beneficiaries APIs
- Add composite indexes on tenant FK columns
- Consolidate subscription status queries
- Migrate pages to TanStack Query hooks
- Debounce/remove pathname-driven check-session refetch
- Rate limit auth and PIN routes

### Phase 1 — Structural (score 52 → ~72)
- RSC migration for dashboard, assets, beneficiaries lists
- Code-split Stripe and modals via `next/dynamic`
- Cache reference data (plans, relationships, asset-types)
- Single-pass auth context per API handler
- Fix dashboard aggregate stats

### Phase 2 — Scale architecture (score 72 → ~85)
- Async webhook queue (enqueue + worker)
- Upload presigned/direct-to-storage path
- Load testing harness + baseline
- Observability (request duration, Supabase latency)
- Parallel wizard uploads

### Phase 3 — 10k+ hardened (score 85 → ~90+)
- Edge caching for read-heavy endpoints
- Circuit breakers on external providers (Stripe, Resend)
- Storage quota enforcement with accurate metering
- PIN session JWT hardening + lockout policy

---

## Load Testing Strategy

| Tier | Tool | Scenarios |
|------|------|-----------|
| Smoke | k6 or Artillery | Health: session, dashboard, assets list (paginated) |
| Load | k6 | 1k VUs sustained 10m: mixed read (70%) / write (20%) / upload (10%) |
| Stress | k6 | Ramp 1k → 10k VUs; find breaking point on `/api/assets`, check-session |
| Soak | k6 | 500 VUs 2h; memory/leak detection on upload streams |
| E2E perf | Playwright | LCP/TTI on dashboard, billing; trace API waterfall |

**Baseline targets (post Phase 1):**
- p95 API read < 300ms
- p95 page LCP < 2.5s
- Error rate < 0.1% at 1k concurrent

---

## Capacity Planning (rough)

| Resource | 1k users | 10k users | Notes |
|----------|----------|-----------|-------|
| Vercel serverless invocations | ~50 req/s avg | ~500 req/s | check-session multiplies load |
| Supabase Auth API | ~20 req/s | ~200 req/s | Every navigation + API auth |
| Postgres (Supabase) | 2–4 vCPU sufficient | 8+ vCPU or read replicas | After indexes + pagination |
| Storage egress | Low | Medium | Encrypted streams; CDN for downloads |

---

## Production metrics to monitor

- **Frontend:** LCP, INP, CLS (Vercel Analytics / RUM)
- **API:** p50/p95/p99 latency per route, 4xx/5xx rate, cold start duration
- **Auth:** `getUser()` call rate, session validation failures
- **Database:** Query duration, connection count, index hit rate
- **Security:** PIN verify attempts/min, lockout triggers, OTP creation rate
- **Billing:** Webhook processing lag, Stripe API errors, subscription status cache hit rate
- **Storage:** Upload duration, bytes in/out, failed encrypt/decrypt count
- **Business:** Assets/beneficiaries per user (payload size proxy)

### Alert thresholds (route timing via `withTiming`)

| Level | Duration | Action |
|-------|----------|--------|
| ok | < 500ms | Normal |
| warn | 500ms – 2000ms | Investigate hot route |
| critical | > 2000ms | Page on-call; check DB/Supabase latency |

Instrumented routes: `GET /api/assets`, `GET /api/beneficiaries`, `GET /api/dashboard`, `GET /api/security/check-session`.

Configure Vercel log drain to capture structured `route_timing` JSON logs for APM dashboards.

---

## Finding ID reference (for user stories)

| Prefix | Domain |
|--------|--------|
| F-* | Frontend |
| B-* | Backend API |
| D-* | Database / migrations |
| S-* | Security / auth overhead |
| N-* | Network / CDN |
| L-* | Low priority / cleanup |

Mapped to stories in `plan/manifest.json` via `sourceFindings`.
