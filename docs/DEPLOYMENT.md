# Iablee App — Deployment Guide (Fresh Supabase)

This guide covers deploying the Iablee Next.js app against a **fresh Supabase project**: database schema (tables, triggers, RLS), Storage, Auth redirect URLs, environment variables, and optional billing/encryption.

---

## 1. Documentation map

| Document | Purpose |
|----------|--------|
| **README.md** | Quick start, env vars, deploy on Vercel |
| **docs/setup-supabase.md** | Create Supabase project, get credentials, run migrations |
| **docs/run-migration.md** | Inline SQL for core tables + RLS (alternative to CLI) |
| **docs/SUPABASE_ARCHITECTURE_ANALYSIS.md** | Anon vs service role, frontend vs API usage |
| **docs/BILLING-SETUP.md** | Stripe/PayU, webhooks, billing plans |
| **docs/supabase-redirect-setup.md** | Auth redirect URLs for OAuth (Google/Apple) |
| **docs/encryption.md** | File encryption, pgsodium, key rotation |
| **docs/TECHNICAL-SPECIFICATIONS.md** | Subscription/payments architecture |
| **ABOUT.md** | Product and architecture overview |

---

## 2. Environment variables

Set these in `.env.local` (development) or in your host (e.g. Vercel) for production.

### Required for core app

```bash
# Supabase (required)
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...

# Backend / middleware / billing (required for full functionality)
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

- **NEXT_PUBLIC_***: Used by the browser (Supabase client, auth).
- **SUPABASE_SERVICE_ROLE_KEY**: Server-only (middleware, API routes, billing). Never expose to the client.

### Optional: billing

See **docs/BILLING-SETUP.md**. Example for Stripe:

```bash
PAYMENT_GATEWAY=stripe
NEXT_PUBLIC_PAYMENT_GATEWAY=stripe
STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

### Optional: file encryption

See **docs/encryption.md**. For envelope encryption of storage files:

```bash
STORAGE_MASTER_KEY=<hex-key>
```

---

## 3. Supabase: migration order (fresh project)

Migrations in `supabase/migrations/` **must run in dependency order**. The first migration in the repo (`20250101000000_create_digital_assets_and_beneficiaries.sql`) depends on **`public.users`** and **`public.relationships`**, so those must exist first.

Recommended order for a **fresh** Supabase database:

| Order | Migration file | What it does |
|-------|----------------|--------------|
| 1 | **20241201000000_create_users_and_relationships.sql** | Creates `public.users` and `public.relationships` (base for RLS and FKs). |
| 2 | 20250101000000_create_digital_assets_and_beneficiaries.sql | `digital_assets`, `beneficiaries`, RLS. |
| 3 | 20250531041436_create_users_table.sql | Ensures `users` table (IF NOT EXISTS). |
| 4 | 20251029000000_create_billing_tables.sql | Billing tables, triggers, RLS. |
| 5 | 20251029000001_seed_billing_plans.sql | Seeds `billing_plans`. |
| 6 | 20251113000000_create_asset_types.sql | `asset_types`, `asset_type_billing_plans`, seed data. |
| 7 | 20260131193300_enable_storage_rls.sql | RLS for `storage.objects` (bucket `assets`). |
| 8 | 20260213143000_create_asset_attachments.sql | `asset_attachments`, RLS, optional data migration from `digital_assets.files`. |
| 9 | 20260216200000_create_security_otps.sql | `security_otps` (PIN reset, etc.). |

### Applying migrations

**Option A — Supabase CLI (recommended)**

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

The repo includes **20241201000000_create_users_and_relationships.sql**; it runs first by filename order. If your repo only had the later migrations, run the “base” migration once manually (Option B), then `supabase db push` for the rest.

**Option B — Manual (SQL Editor)**

1. In Supabase Dashboard → **SQL Editor**, run in this order:
   - Contents of `supabase/migrations/20241201000000_create_users_and_relationships.sql`
   - Then each file from `20250101000000` through `20260216200000` as listed above.

---

## 4. Database objects reference

### 4.1 Tables

| Table | Migration | Notes |
|-------|-----------|--------|
| **public.users** | 20241201 / 20250531 | id (uuid, PK), email, full_name, created_at, updated_at. RLS: insert/select own row. |
| **public.relationships** | 20241201 | id (serial), key (text), generation_level (int). Lookup for beneficiary relationship. |
| **public.digital_assets** | 20250101 | user_id, asset_type, asset_name, beneficiary_id, status, email, password, website, valid_until, description, files (jsonb), number_of_files, etc. RLS: own rows. |
| **public.beneficiaries** | 20250101 | user_id, full_name, email, phone_number, notes, relationship_id (FK → relationships), status, notified, email_verified, etc. RLS: own rows. |
| **public.billing_plans** | 20251029 | Plan definitions, provider_price_map. RLS: authenticated read. |
| **public.billing_subscriptions** | 20251029 | user_id, plan_id, provider, provider_subscription_id, status, etc. RLS: own rows. |
| **public.billing_payment_methods** | 20251029 | user_id, provider, token, brand, last4, etc. RLS: own rows. |
| **public.billing_invoices** | 20251029 | user_id, subscription_id, provider, amount_cents, status, etc. RLS: own rows. |
| **public.billing_webhook_events** | 20251029 | Idempotency log; no client RLS (service role only). |
| **public.asset_types** | 20251113 | key, name, icon, custom_fields, etc. RLS: authenticated read; service_role manage. |
| **public.asset_type_billing_plans** | 20251113 | Junction asset_types ↔ billing_plans. |
| **public.asset_attachments** | 20260213 | asset_id, file_path, file_name, file_type, file_size. RLS: via asset ownership. |
| **public.security_otps** | 20260216 | user_id (auth.users), code, expires_at, verified. |

### 4.2 Triggers

| Trigger | Table | Function | Purpose |
|---------|--------|----------|---------|
| set_billing_plans_updated_at | billing_plans | handle_updated_at() | Set updated_at on update. |
| set_billing_subscriptions_updated_at | billing_subscriptions | handle_updated_at() | Same. |
| set_billing_payment_methods_updated_at | billing_payment_methods | handle_updated_at() | Same. |
| set_billing_invoices_updated_at | billing_invoices | handle_updated_at() | Same. |
| set_asset_types_updated_at | asset_types | handle_updated_at() | Same. |

**Function:** `public.handle_updated_at()` — defined in `20251029000000_create_billing_tables.sql`; sets `NEW.updated_at = now()`.

### 4.3 RLS (Row Level Security)

- **users**: Insert/select own row only (`auth.uid() = id`).
- **digital_assets, beneficiaries**: Select/insert/update/delete only when `auth.uid() = user_id`.
- **billing_plans**: Select for `auth.role() = 'authenticated'`.
- **billing_subscriptions, billing_payment_methods, billing_invoices**: Full CRUD for own rows (`auth.uid() = user_id`).
- **billing_webhook_events**: No client policies (service role only).
- **asset_types**: Select for authenticated where `is_active = true`; service_role can manage.
- **asset_type_billing_plans**: Select for authenticated; service_role can manage.
- **asset_attachments**: Select/insert/delete only for assets owned by `auth.uid()`.
- **storage.objects**: In `20260131193300_enable_storage_rls.sql` — allow insert/select/update/delete for objects in bucket `assets` when `(storage.foldername(name))[1] = auth.uid()::text`.

### 4.4 Optional: sync `auth.users` → `public.users`

The app expects a row in `public.users` for each `auth.users` user (profile, middleware). There is no migration that creates this row automatically. To sync on sign-up (email or OAuth), run once in SQL Editor:

```sql
-- Optional: create public.users row when a new auth user is created
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', '')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
```

---

## 5. Storage

- **Bucket name:** `assets`.
- **Creation:** Not created by migrations. In Supabase Dashboard → **Storage** → **New bucket**, create a bucket named **assets** (public or private as per your design; RLS in `20260131193300` restricts access by `auth.uid()` in the path).
- **RLS:** Applied by `20260131193300_enable_storage_rls.sql` on `storage.objects` for bucket `assets` and paths under `auth.uid()`.

---

## 6. Auth (redirect URLs)

For OAuth (Google/Apple) and email links to work:

1. Supabase Dashboard → **Authentication** → **URL Configuration**.
2. **Site URL:** e.g. `https://app.iablee.com` or `http://localhost:3000`.
3. **Redirect URLs:** Add (see **docs/supabase-redirect-setup.md**):
   - `http://localhost:3000/en/auth/callback`
   - `http://localhost:3000/es/auth/callback`
   - `http://localhost:3000/auth/callback`
   - Production: `https://your-domain.com/en/auth/callback`, `https://your-domain.com/es/auth/callback`, etc.

---

## 7. Billing (Stripe / PayU)

- **Plans:** Seeded by `20251029000001_seed_billing_plans.sql`. Update `billing_plans.provider_price_map` with real Stripe (or other) price IDs.
- **Webhooks:** Configure in Stripe (or PayU) to point to `https://your-domain.com/api/webhooks/stripe` (or `/api/webhooks/payu`). See **docs/BILLING-SETUP.md** for events and secrets.

---

## 8. Optional: encryption (pgsodium / envelope)

- **File encryption:** Envelope encryption for storage; see **docs/encryption.md** and `STORAGE_MASTER_KEY`.
- **DB encryption:** If you use pgsodium for columns (e.g. `password`, `custom_fields` on `digital_assets`), the `safe_decrypt`, `decrypted_digital_assets` view, and triggers are described in **docs/encryption.md**. Those SQL snippets are not in the repo migrations; apply them manually if you enable this.

---

## 9. Deploying the Next.js app

- Build: `npm run build`
- Start: `npm run start`
- Deploy to Vercel (or any Node host): connect repo, set env vars above, and ensure `NEXT_PUBLIC_SUPABASE_URL` is `https://*.supabase.co`.

---

## 10. Checklist (fresh Supabase)

- [ ] Create Supabase project; copy URL and anon key.
- [ ] Add and run base migration: **20241201000000_create_users_and_relationships.sql** (if not already applied).
- [ ] Run remaining migrations in order (via `supabase db push` or SQL Editor).
- [ ] Create Storage bucket **assets**.
- [ ] Set redirect URLs in Auth.
- [ ] Set env vars (Supabase + optional billing + optional encryption).
- [ ] Optional: add `handle_new_user` trigger for `public.users` sync.
- [ ] Optional: configure Stripe/PayU and webhooks; update `provider_price_map`.
- [ ] Deploy Next.js app and test login, wizard, assets, and storage.
