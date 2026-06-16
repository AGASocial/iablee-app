# iablee-app Agents

Agent team for plan-driven development. Backlog lives in `plan/`.

## Quick invoke

| Agent | Prompt |
|-------|--------|
| Master | `You are the Master Agent. Read plan/manifest.json and assign the next eligible story.` |
| Frontend | `You are the NextJS Frontend Developer. Implement US-F-001 from plan/manifest.json.` |
| Backend | `You are the NextJS Backend Developer. Implement US-B-001 from plan/manifest.json.` |
| QA | `You are the QA Specialist. Validate US-F-001 against plan/frontend/USER-STORIES.md.` |

## Team

| Agent | Role | Skill | Queue |
|-------|------|-------|-------|
| Master Agent | Orchestrates backlog, assigns work, syncs status | `plan-orchestrator` | `plan/agents/master.md` |
| NextJS Frontend Developer | Pages, components, i18n, billing UI, RSC | `iablee-nextjs-frontend` | `plan/agents/nextjs-frontend-developer.md` |
| NextJS Backend Developer | API routes, middleware, Supabase, webhooks | `iablee-nextjs-backend` | `plan/agents/nextjs-backend-developer.md` |
| QA Specialist | Jest, Playwright, validation gates | `iablee-qa` | `plan/agents/qa-specialist.md` |

Skills: `.cursor/skills/`  
Plan index: `plan/manifest.json` (22 stories · 95 tasks)  
Audit: `plan/PERFORMANCE-REVIEW.md` (readiness score: **34/100**)  
Human-readable stories: `plan/{frontend,backend,qa}/USER-STORIES.md`

## Why these four agents?

Based on the iablee-app codebase scan:

- **Single Next.js monolith** — not split apps like admin-portal + mobile; frontend and backend are separate *concerns* in one repo
- **36 API routes** + **middleware** + **10 Supabase migrations** → dedicated backend agent
- **19 locale pages**, **45 components**, **en/es i18n** → dedicated frontend agent
- **Jest + Playwright** already in place → QA agent owns coverage and DONE gates
- **Master** coordinates `dependsOn` chains (e.g. billing UI after subscription gating)

## Optional future agents

| Agent | When to add |
|-------|-------------|
| Supabase/Database Specialist | If migration volume grows beyond backend agent capacity |
| Billing/Payments Specialist | If Stripe + PayU + multi-provider complexity increases |
| DevOps/Deployment | If CI/CD and Vercel infra become a separate workstream |

## Autonomous development

```
Execute the plan backlog autonomously. Use plan-orchestrator skill.
```

The Master Agent will pick PENDING stories by phase and priority, respect dependencies, and loop implement → QA → DONE.
