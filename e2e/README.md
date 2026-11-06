# Playwright E2E (iablee)

This suite runs end-to-end tests against the local Next.js dev server and a real Supabase project from your environment variables.

## Run

```bash
npm run test:e2e
```

## Notes

- The suite uses local `webServer` startup (`npm run dev`) with `reuseExistingServer: true`.
- Throwaway users are created with the Supabase service role and cleaned after each test.
- A global teardown sweeps any leftover `e2e-*@iablee.test` users and related data.
- `playwright-report/` and `test-results/` are ignored by git.
