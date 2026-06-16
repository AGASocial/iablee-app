---
name: plan-orchestrator
description: Orchestrates iablee-app plan backlog from plan/manifest.json. Picks stories by phase, priority, and dependsOn; assigns NextJS Frontend, NextJS Backend, or QA specialists; syncs status. Use when executing plan tasks, assigning user stories, or running autonomous plan development.
---

# Plan Orchestrator (iablee-app)

Coordinate the iablee agent team against `plan/manifest.json`.

## Source of truth

| File | Purpose |
|------|---------|
| `plan/manifest.json` | Machine-readable stories, tasks, status, agents, dependencies |
| `plan/{frontend,backend,qa}/USER-STORIES.md` | Acceptance criteria and human context |
| `plan/agents/*.md` | Per-agent queues and constraints |

## Story selection order

1. Filter `status: "PENDING"` stories
2. Respect `dependsOn` — all listed stories must be `DONE`
3. Sort by `phase` ASC, then `priority` (Critical > High > Medium > Low)
4. Prefer same-domain batching when no dependency conflict

**Phase 0 kickoff order:** US-B-010 → US-B-001 → US-B-002 → US-B-003 → US-F-003 → US-F-002 → US-B-005 → US-B-008 → US-Q-003 → US-Q-004

Source audit: `plan/PERFORMANCE-REVIEW.md` · Readiness score: 34/100

## Assignment protocol

For each story:

```
✅ ASSIGNED — [Agent]
Story: [US-*-###] [title]
Phase: [N] · Priority: [level]
Tasks: [T-*-###-1 … N]
Codebase: [paths]
Depends on: [DONE / blocked by US-*]
```

Load the agent's skill before implementation:
- NextJS Frontend Developer → `iablee-nextjs-frontend`
- NextJS Backend Developer → `iablee-nextjs-backend`
- QA Specialist → `iablee-qa`

## Status sync (required)

Update **both** when status changes:

1. `plan/manifest.json` — story `status` and each task `status`
2. `plan/{domain}/USER-STORIES.md` — story status field and child task table

Status values: `PENDING` → `IN-PROGRESS` → `DONE`

## Per-story loop

1. **Assign** — set story + first task to `IN-PROGRESS`
2. **Implement** — specialist completes child tasks one-by-one, marking each `DONE`
3. **QA** — validate acceptance criteria; run lint/build/tests
4. **Close** — set story `DONE` only when all tasks pass QA

## Blockers

Pause and report when:
- `dependsOn` story not `DONE`
- Missing env (Supabase, Stripe, Resend)
- User-only decision (plan pricing, grace period policy)
- QA FAIL with CRITICAL severity after one fix attempt

## Status report format

```
📊 PLAN STATUS
Done: [N]/22 stories · [M]/95 tasks
In progress: [US-*-###]
Next up: [US-*-###] → [Agent]
Blocked: [list]
```

## Autonomous mode

When user says "execute plan", "work the backlog", or "open card on plan":

1. Read `plan/manifest.json` and `plan/README.md`
2. Pick next eligible story
3. Act as assigned specialist (load skill)
4. Act as QA when implementation complete
5. Update manifest + USER-STORIES.md
6. Continue to next story unless blocked or user stops

Do not ask permission between stories unless blocked.
