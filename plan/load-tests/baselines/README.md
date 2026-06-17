# k6 performance baselines

Store dated k6 run results so you can compare performance over time (localhost vs production, before/after deploys, etc.).

## Folder layout

```
plan/load-tests/baselines/results/
├── localhost/
│   └── 2026-06-16/
│       ├── manifest.json
│       ├── REPORT.md
│       └── *.summary.json
└── production/
    └── 2026-06-16/
        ├── manifest.json
        ├── REPORT.md
        └── *.summary.json
```

## Quick start

```bash
# 1. Simple config (URL only — no cookie here)
cp plan/load-tests/.env.localhost.example plan/load-tests/.env.localhost

# 2. Auth cookie in a separate file (avoids bash parsing errors)
cp plan/load-tests/auth-cookie.localhost.example.txt plan/load-tests/auth-cookie.localhost.txt
```

Paste **one line** into `auth-cookie.localhost.txt` — the full `Cookie` header from DevTools:

```
sb-cxhqsedenxgrhnjiznco-auth-token.0=base64-eyJ...; sb-cxhqsedenxgrhnjiznco-auth-token.1=mlkIjoi...
```

Include **both** `.0` and `.1` (Supabase splits large tokens). Do not put this in `.env.localhost` — the `=` characters break `source`.

```bash
# 3. Run
./plan/load-tests/run-baseline.sh localhost
# or: npm run test:load:baseline:localhost

# Production
cp plan/load-tests/.env.production.example plan/load-tests/.env.production
cp plan/load-tests/auth-cookie.production.example.txt plan/load-tests/auth-cookie.production.txt
./plan/load-tests/run-baseline.sh production
```

## Compare runs

Same environment:

```bash
node plan/load-tests/compare-baselines.mjs \
  plan/load-tests/baselines/results/localhost/2026-06-16 \
  plan/load-tests/baselines/results/localhost/2026-06-20
```

Localhost vs production:

```bash
node plan/load-tests/compare-baselines.mjs \
  plan/load-tests/baselines/results/localhost/2026-06-16 \
  plan/load-tests/baselines/results/production/2026-06-16
```

## What to commit

- ✅ `manifest.json`, `*.summary.json`, `REPORT.md` under `baselines/results/`
- ❌ `.env.*`, `auth-cookie.*.txt`, `*.raw.json`, `*.log`

See also [docs/TESTING.md](../../../docs/TESTING.md).
