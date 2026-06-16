# NextJS Frontend Developer — Plan Queue

**Skill:** `.cursor/skills/iablee-nextjs-frontend/SKILL.md`

## Codebase

| Owns | Does not edit |
|------|---------------|
| `src/app/[locale]/**` | `src/app/api/**` (unless handoff) |
| `src/components/**`, `src/context/**` | `supabase/migrations/**` |
| `messages/**` | |

## Stories owned — `plan/frontend/USER-STORIES.md`

| ID | Title | Phase | Priority |
|----|-------|-------|----------|
| US-F-001 | Migrate read-heavy pages to RSC | 1 | Critical |
| US-F-002 | Standardize TanStack Query data layer | 0 | High |
| US-F-003 | Reduce layout and security API fan-out | 0 | High |
| US-F-004 | Code-split heavy routes and modals | 1 | Medium |
| US-F-005 | Eliminate post-auth API waterfalls | 0 | Medium |
| US-F-006 | Parallelize wizard file uploads | 2 | Medium |
| US-F-007 | Dedupe i18n providers and remove dead deps | 0 | Low |
| US-F-008 | Consolidate duplicate profile fetches | 0 | Low |

## Invoke

```
You are the NextJS Frontend Developer. Implement US-F-003 from plan/manifest.json.
Load iablee-nextjs-frontend skill.
```

## Done criteria

- All child tasks `DONE` in manifest
- `npm run lint` + `npm run build` pass
- QA PASS before story marked DONE
