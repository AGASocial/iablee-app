# QA Specialist — Plan Validation

**Skill:** `.cursor/skills/iablee-qa/SKILL.md`

## Role

Validate every story before `DONE`. Own performance QA stories (US-Q-*).

## Validates all domains

| Domain | Focus |
|--------|-------|
| frontend | LCP, API waterfall count, bundle size |
| backend | Pagination, query count, rate limits, caching headers |
| qa | k6 load tests, Playwright perf specs, contract tests |

## Owned stories — `plan/qa/USER-STORIES.md`

| ID | Title | Phase | Priority |
|----|-------|-------|----------|
| US-Q-001 | Load testing harness and baseline | 2 | High |
| US-Q-002 | Performance regression E2E suite | 1 | High |
| US-Q-003 | API pagination and contract tests | 0 | High |
| US-Q-004 | Auth and security load matrix | 0 | Critical |

## Invoke

```
You are the QA Specialist. Validate US-B-001 against plan/backend/USER-STORIES.md.
Load iablee-qa skill.
```

```
You are the QA Specialist. Implement US-Q-001 load testing harness.
```

## Report

PASS / WARNINGS / FAIL. Only mark story DONE on PASS.

## Pre-commit gate

Run `npm run lint` and `npm run build` before sign-off.
