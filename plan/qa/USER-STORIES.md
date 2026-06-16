# QA User Stories — Performance & Scalability

Backlog from [PERFORMANCE-REVIEW.md](../PERFORMANCE-REVIEW.md) (June 2026).  
Default agent: **QA Specialist**

---

## US-Q-001 — Load testing harness and baseline

| Field | Value |
|-------|-------|
| **Status** | `PENDING` |
| **Priority** | High |
| **Phase** | 2 |
| **Source findings** | (load strategy) |
| **Depends on** | US-B-001, US-B-003 |

### Description

As a **team**, we want a k6 or Artillery harness with documented baselines so that we can prove 10k-user readiness and catch regressions.

No load tests exist today (unlike CADENZA's load-tests folder).

### Acceptance criteria

- [ ] k6 scripts for smoke, load (1k VUs), and stress scenarios
- [ ] Scenarios cover assets list, dashboard, check-session, login
- [ ] Baseline p95 latencies recorded in docs/TEST_SUMMARY.md
- [ ] Runnable locally and in CI (optional nightly)

### Child tasks

| ID | Task | Status |
|----|------|--------|
| T-Q-001-1 | Add plan/load-tests/ directory with k6 dashboard script | PENDING |
| T-Q-001-2 | Add k6 script for assets list (paginated) | PENDING |
| T-Q-001-3 | Add k6 script for auth + check-session storm | PENDING |
| T-Q-001-4 | Document env setup and run commands in TESTING.md | PENDING |
| T-Q-001-5 | Record baseline metrics after Phase 0 fixes | PENDING |

---

## US-Q-002 — Performance regression E2E suite

| Field | Value |
|-------|-------|
| **Status** | `PENDING` |
| **Priority** | High |
| **Phase** | 1 |
| **Source findings** | F-1, F-5 |
| **Depends on** | US-F-001 |

### Description

As a **team**, we want Playwright traces that assert API call counts and navigation timing so that frontend perf regressions are caught in CI.

### Acceptance criteria

- [ ] E2E test records network requests on dashboard load
- [ ] Assert max API calls on navigation (post US-F-003)
- [ ] Login → dashboard flow completes under threshold
- [ ] Playwright trace artifacts documented for debugging

### Child tasks

| ID | Task | Status |
|----|------|--------|
| T-Q-002-1 | Add performance spec with request counting helper | PENDING |
| T-Q-002-2 | Assert dashboard loads with ≤N API calls after RSC migration | PENDING |
| T-Q-002-3 | Assert navigation does not refetch check-session | PENDING |
| T-Q-002-4 | Document perf E2E in docs/TESTING.md | PENDING |

---

## US-Q-003 — API pagination and contract tests

| Field | Value |
|-------|-------|
| **Status** | `PENDING` |
| **Priority** | High |
| **Phase** | 0 |
| **Source findings** | B-1, B-2 |
| **Depends on** | US-B-001, US-B-002 |

### Description

As a **team**, we want Jest tests that verify pagination contracts and subscription query efficiency so that backend scale fixes stay enforced.

### Acceptance criteria

- [ ] Tests for cursor pagination shape on assets and beneficiaries
- [ ] Tests for list response excluding decrypted secrets
- [ ] Mock assertion that subscription status uses bounded queries
- [ ] 429 rate limit responses tested on auth routes

### Child tasks

| ID | Task | Status |
|----|------|--------|
| T-Q-003-1 | Add pagination contract tests for GET /api/assets | PENDING |
| T-Q-003-2 | Add pagination tests for GET /api/beneficiaries | PENDING |
| T-Q-003-3 | Add subscription status integration test | PENDING |
| T-Q-003-4 | Add rate limit unit tests for limiter utility | PENDING |

---

## US-Q-004 — Auth and security load matrix

| Field | Value |
|-------|-------|
| **Status** | `PENDING` |
| **Priority** | Critical |
| **Phase** | 0 |
| **Source findings** | B-2, S-1, D-2 |
| **Depends on** | US-B-003, US-B-010 |

### Description

As a **team**, we want a documented matrix of auth/security endpoints under load so that PIN brute-force and session storms are validated before production scale.

### Acceptance criteria

- [ ] Matrix: login, verify-pin, check-session, forgot-pin × expected limits
- [ ] Automated tests for lockout after N PIN failures
- [ ] Manual k6 steps for check-session at 100 req/s documented
- [ ] Results recorded in TEST_SUMMARY.md

### Child tasks

| ID | Task | Status |
|----|------|--------|
| T-Q-004-1 | Define auth/security load test matrix document | PENDING |
| T-Q-004-2 | Add Jest tests for PIN lockout behavior | PENDING |
| T-Q-004-3 | Add k6 smoke for verify-pin rate limit (expect 429) | PENDING |
| T-Q-004-4 | Run matrix and record baseline | PENDING |

---

## Validation protocol (performance stories)

When validating any performance story before DONE:

1. Run `npm run test` and relevant E2E specs
2. Run `npm run lint` and `npm run build`
3. For backend stories: verify p95 improvement or query count reduction (document in PR)
4. For frontend stories: verify reduced network waterfall (Playwright trace or DevTools HAR)
5. Report PASS / WARNINGS / FAIL with metrics
