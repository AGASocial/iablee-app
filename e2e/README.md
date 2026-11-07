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
