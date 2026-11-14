# Playwright E2E (iablee)

This suite runs end-to-end tests against the local Next.js dev server and a real Supabase project from your environment variables.

## Run

```bash
npm run test:e2e
```

## Required runtime guard for real Supabase

Service-role actions are blocked unless this explicit runtime opt-in is set:

```bash
PLAYWRIGHT_E2E_REAL_SUPABASE=1
```

Example run with local browser override:

```bash
PLAYWRIGHT_E2E_REAL_SUPABASE=1 PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/absolute/path/to/chrome npm run test:e2e
```

## Manual dev server for e2e (APP_TOKEN_SECRET)

When you start the Next.js server yourself (instead of letting Playwright's `webServer` start it), you **must** set `APP_TOKEN_SECRET` in the process environment to a string of at least 32 characters. Playwright injects a test-only default for that key only when `webServer` starts the server; an already-running server without it can make PIN/security routes fail (e.g. `/api/security/verify-pin`).

Example (key name only — use any local test value ≥32 chars; do not commit real secrets):

```bash
APP_TOKEN_SECRET=<local-test-secret-min-32-chars> PORT=3007 npm run dev
```

Then run:

```bash
PLAYWRIGHT_E2E_REAL_SUPABASE=1 PLAYWRIGHT_TEST_BASE_URL=http://localhost:3007 npx playwright test
```

## Notes

- The suite uses local `webServer` startup (`npm run dev`) with `reuseExistingServer: true`.
- Service-role fixtures are hard-blocked unless:
  - `PLAYWRIGHT_E2E_REAL_SUPABASE=1` is set for the current run.
  - `NEXT_PUBLIC_SUPABASE_URL` points exactly to `lrnhrzpwgyhkruwxeppw.supabase.co`.
  - `PLAYWRIGHT_TEST_BASE_URL` is local (`localhost`, `127.0.0.1`, `0.0.0.0`, or `::1`).
- Throwaway users include per-run metadata (`e2e_run_id`) and are tracked in a run manifest under `test-results/`.
- Cleanup only targets users created by the current run and fails loudly on DB/storage deletion errors.
- Playwright defaults to bundled headless Chromium. Use `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/absolute/path` only as an explicit local opt-in workaround.
- `playwright-report/` and `test-results/` are ignored by git.

## Contrast coverage (KAN-145 / KAN-146)

Permanent suites are **not** an exhaustive locale×theme×viewport matrix:

| Spec | What it covers |
|------|----------------|
| `e2e/09-contrast.spec.ts` | Mostly `/es` routes (light+dark) + one `/en` title sample; plan-limit disabled CTA; landing premium CTA |
| `e2e/10-contrast-full.spec.ts` | Auth routes en+es × light+dark desktop + **one** mobile combo; key overlays; public routes; payment returns; verify-email; real Sonner toasts; login focus rings |
| `e2e/contrast-full-audit.spec.ts` | Full audit (env-gated: `CONTRAST_AUDIT_PHASE=before\|after`); skips unless that env is set |

For the exhaustive matrix (every route/state × es/en × light/dark × desktop/mobile), run the env-gated full audit — not `09`/`10` alone.
