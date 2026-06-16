# iablee Performance & Scalability Plan

Backlog derived from the [Performance & Scalability Review](./PERFORMANCE-REVIEW.md) (June 2026).  
**Scalability readiness score: 34/100** → target **90+** at 10k concurrent users.

## Folder structure

```
plan/
├── README.md
├── PERFORMANCE-REVIEW.md     ← Full audit, bottleneck report, roadmap
├── manifest.json             ← 22 stories · 95 tasks
├── agents/
├── frontend/USER-STORIES.md  ← 8 stories (US-F-001 … US-F-008)
├── backend/USER-STORIES.md   ← 11 stories (US-B-001 … US-B-011)
├── qa/USER-STORIES.md        ← 4 stories (US-Q-001 … US-Q-004)
└── load-tests/               ← (created by US-Q-001)
```

## Phase 0 kickoff (Critical path)

| Order | Story | Agent |
|-------|-------|-------|
| 1 | US-B-010 | NextJS Backend — indexes + RLS |
| 2 | US-B-001 | NextJS Backend — pagination |
| 3 | US-B-002 | NextJS Backend — subscription queries |
| 4 | US-B-003 | NextJS Backend — rate limits |
| 5 | US-F-003 | NextJS Frontend — security fan-out |
| 6 | US-F-002 | NextJS Frontend — TanStack Query |
| 7 | US-B-005 | NextJS Backend — billing singleton |
| 8 | US-B-008 | NextJS Backend — dashboard stats |
| 9 | US-Q-003 | QA — pagination contract tests |
| 10 | US-Q-004 | QA — auth load matrix |

## Score impact by phase

| Phase | Focus | Target score |
|-------|--------|--------------|
| **0** | Pagination, indexes, rate limits, query dedup, fan-out | 34 → ~52 |
| **1** | RSC, caching, code-split, single-pass auth | 52 → ~72 |
| **2** | Async webhooks, load tests, observability | 72 → ~85 |
| **3** | Edge cache, circuit breakers, storage metering | 85 → ~90+ |

See [PERFORMANCE-REVIEW.md](./PERFORMANCE-REVIEW.md) for bottleneck details, load strategy, and production metrics.
