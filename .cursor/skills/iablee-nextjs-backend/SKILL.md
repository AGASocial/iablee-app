---
name: iablee-nextjs-backend
description: Implements iablee-app backend stories (US-B-*) from plan/manifest.json. Covers Next.js Route Handlers, middleware, Supabase Auth/RLS/migrations, Stripe/PayU webhooks, envelope encryption, and Resend notifications. Use when working on API routes, subscription gating, security PIN, or database migrations.
---

# iablee NextJS Backend Developer

Implement API, middleware, and database stories for iablee-app.

## Scope

| Owns | Does not touch |
|------|----------------|
| `src/app/api/**` | Dashboard page components (unless handoff) |
| `src/middleware.ts` | Pure UI in `src/components/**` |
| `src/lib/**` — supabase, auth, encryption, billing | E2E specs (QA owns) |
| `supabase/migrations/**` | |

## Before starting

1. Read assigned story in `plan/manifest.json` and `plan/backend/USER-STORIES.md`
2. Review related migrations in `supabase/migrations/`
3. Set story + current task to `IN-PROGRESS` in manifest and USER-STORIES.md

## Codebase patterns

- **Supabase** — `@supabase/ssr` and auth-helpers; never bypass RLS in user-facing routes
- **Middleware** — chains next-intl then session check; extend carefully for subscription gating
- **API routes** — validate session; return consistent JSON error shapes
- **Billing** — Stripe primary; PayU at `webhooks/payu`; plans seeded in migrations
- **Security** — PIN routes under `/api/security/*`; envelope encryption per `docs/encryption.md`
- **Storage** — uploads via `/api/storage/upload`; RLS on storage bucket

## API groups

| Prefix | Responsibility |
|--------|----------------|
| `/api/auth/*` | Login, register, OAuth, session, password reset |
| `/api/assets/*` | Digital assets CRUD + attachments |
| `/api/beneficiaries/*`, `/api/relationships/*` | Beneficiary management |
| `/api/billing/*` | Plans, subscriptions, payment methods, invoices |
| `/api/subscription/*` | Status and limit checks |
| `/api/webhooks/*` | Stripe, PayU |
| `/api/security/*` | PIN and session verification |
| `/api/storage/*` | Encrypted file upload |

## Migrations

- Add new SQL files under `supabase/migrations/` with timestamp prefix
- Always include RLS policies for new tables
- Document breaking changes in migration comment header

## Task completion

For each child task:

1. Implement the change
2. Add or update tests in `__tests__/` adjacent to route
3. Mark task `DONE` in `manifest.json` and USER-STORIES.md

## Definition of done (story)

- [ ] All acceptance criteria checked off in USER-STORIES.md
- [ ] All child tasks `DONE`
- [ ] RLS intact; no service-role leaks to client routes
- [ ] `npm run lint` and `npm run build` pass
- [ ] Route tests added where applicable
- [ ] QA Specialist PASS before story marked DONE

## Reference docs

- `docs/TECHNICAL-SPECIFICATIONS.md` — subscription schema and webhooks
- `docs/encryption.md` — envelope encryption
- `docs/DEPLOYMENT.md` — migration order and env vars
- `src/middleware.ts` — auth and locale flow
