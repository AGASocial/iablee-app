---
name: iablee-nextjs-frontend
description: Implements iablee-app frontend stories (US-F-*) from plan/manifest.json. Covers Next.js App Router pages, React components, next-intl i18n, TanStack Query, billing UI, and RSC migration. Use when working on dashboard, auth, wizard, billing, settings, or digital assets UI.
---

# iablee NextJS Frontend Developer

Implement frontend stories for the iablee product app.

## Scope

| Owns | Does not touch |
|------|----------------|
| `src/app/[locale]/**` | `src/app/api/**` (unless handoff task) |
| `src/components/**` | `supabase/migrations/**` |
| `messages/en.json`, `messages/es.json` | Webhook handlers |

## Before starting

1. Read assigned story in `plan/manifest.json` and `plan/frontend/USER-STORIES.md`
2. Check `dependsOn` — backend APIs must exist before wiring UI
3. Set story + current task to `IN-PROGRESS` in manifest and USER-STORIES.md

## Codebase patterns

- **Routing** — all pages under `src/app/[locale]/`; use next-intl for strings
- **Auth shell** — middleware redirects unauthenticated users to login; wizard if no assets
- **Forms** — React Hook Form + Zod; shadcn/Radix components in `src/components/ui/`
- **Data** — prefer TanStack Query hooks; migrate away from raw `fetch` + `useState`
- **Billing** — lazy-load Stripe (`@stripe/react-stripe-js`) only on payment actions
- **Theming** — `next-themes` + Tailwind 4; follow existing `theme.ts` tokens

## Key pages

| Route | Purpose |
|-------|---------|
| `/auth/login`, `/auth/register` | Auth forms |
| `/wizard` | First-time onboarding |
| `/dashboard` | Home after login |
| `/digital-assets`, `/beneficiaries` | Core CRUD |
| `/billing`, `/billing/plans` | Subscription UI |
| `/settings/*` | Profile, security PIN, preferences |

## i18n rule

Every new user-visible string requires entries in **both** `messages/en.json` and `messages/es.json`.

## Task completion

For each child task:

1. Implement the change
2. Mark task `DONE` in `manifest.json` and USER-STORIES.md
3. Move to next task

## Definition of done (story)

- [ ] All acceptance criteria checked off in USER-STORIES.md
- [ ] All child tasks `DONE`
- [ ] `npm run lint` passes
- [ ] `npm run build` passes
- [ ] i18n complete for new copy
- [ ] QA Specialist PASS before story marked DONE

## Reference docs

- `ABOUT.md` — product flows
- `docs/TECHNICAL-SPECIFICATIONS.md` — billing UI contracts
- `CLAUDE.md` — middleware and routing conventions
