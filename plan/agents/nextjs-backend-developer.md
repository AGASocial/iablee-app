# NextJS Backend Developer — Plan Queue

**Skill:** `.cursor/skills/iablee-nextjs-backend/SKILL.md`

## Codebase

| Owns | Does not edit |
|------|---------------|
| `src/app/api/**`, `src/middleware.ts` | Dashboard UI (unless handoff) |
| `src/lib/**`, `supabase/migrations/**` | E2E specs (QA owns) |

## Stories owned — `plan/backend/USER-STORIES.md`

| ID | Title | Phase | Priority |
|----|-------|-------|----------|
| US-B-001 | Cursor pagination on list endpoints | 0 | Critical |
| US-B-002 | Consolidate subscription status queries | 0 | Critical |
| US-B-003 | Rate limiting on auth and security routes | 0 | Critical |
| US-B-004 | Cache reference data API responses | 1 | High |
| US-B-005 | Billing service client singleton | 0 | High |
| US-B-006 | Upload size limits and stream-only path | 1 | High |
| US-B-007 | Async webhook processing | 2 | High |
| US-B-008 | Fix dashboard aggregate stats | 0 | Medium |
| US-B-009 | Single-pass auth validation in handlers | 1 | High |
| US-B-010 | Database indexes and RLS hardening | 0 | Critical |
| US-B-011 | Production observability instrumentation | 2 | High |

## Invoke

```
You are the NextJS Backend Developer. Implement US-B-001 from plan/manifest.json.
Load iablee-nextjs-backend skill.
```

## Done criteria

- All child tasks `DONE` in manifest
- RLS intact; route tests where applicable
- `npm run lint` + `npm run build` pass
- QA PASS before story marked DONE
