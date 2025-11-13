### iablee: Technical Business Overview

This document gives an AI engineer all essential context to build and ship new features across the iablee platform. The platform has two codebases in this monorepo:

- iablee application: `iablee-app/` — Next.js 15 app for authenticated users to manage digital assets and beneficiaries.
- marketing site: `iablee-site/` — Jekyll site for public marketing pages and acquisition.

### Product Summary

- Purpose: Securely store a user’s vital digital information and designate beneficiaries who will receive access at the right moment.
- Core entities: Users, Digital Assets, Beneficiaries, Relationships.
- Primary flows:
  - User onboarding and authentication
  - First-time setup (wizard)
  - Ongoing asset CRUD and attachment management
  - Beneficiary CRUD and status tracking
  - Localized UX (English/Spanish)

### Architecture

- Frontend app: Next.js 15, React 19, TypeScript, next-intl for i18n, Radix UI primitives and shadcn-like UI wrappers, Tailwind CSS 4.
- Auth and data: Supabase (Auth, Postgres, RLS policies). Client SDK created via `@supabase/auth-helpers-nextjs`.
- State/form libs: React Hook Form + Zod; TanStack Query available; Sonner for toasts.
- Marketing site: Jekyll 4 with Liquid templates, Tailwind CDN, GTM + Consent Mode, Google Analytics tag, cookie preferences banner.

### Repos and Responsibilities

- `iablee-app/` (product app)
  - Auth, session enforcement, and locale negotiation via middleware
  - Views: auth pages, wizard, dashboard, digital assets, beneficiaries
  - Shared UI components and form controls
  - Supabase client and type definitions
  - i18n routing and translations scaffolding

- `iablee-site/` (marketing site)
  - Jekyll config and layouts
  - SEO tags, GTM (`GT-MK5DRWPX`), GA (`G-WQ020FXKLE`), and cookie consent banner with Consent Mode enforcement
  - Alternate languages supported at the URL level (`es` default with `/en/` alternate)

### Environments and Configuration (app)

- Required env vars for the app (`.env.local`):
  - `NEXT_PUBLIC_SUPABASE_URL` — must be an `https://*.supabase.co` URL; validated at startup.
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY` — anon key for the Supabase project.
- Images: `next.config.ts` allows `localhost`, `appleid.cdn-apple.com`, `www.gstatic.com`.
- i18n locales: `en`, `es` (default `es`) via `next-intl`.

### Authentication and Authorization

- Auth: Supabase Auth via `@supabase/auth-helpers-nextjs`.
- Session handling:
  - Client: `src/lib/auth.ts` exposes `useAuth()` hook to track `user`, `session`, `loading`, `error`, and `signOut()`.
  - Middleware: `src/middleware.ts` combines locale negotiation and Supabase session validation.
    - If no session and path is not `/[locale]/auth/*`, redirect to `/[locale]/auth/login?redirectedFrom=<previous>`.
    - If session and visiting `/[locale]/auth/*`, check if the user has digital assets; redirect to `/[locale]/wizard` (no assets) or `/[locale]/dashboard` (has assets).
- Row-Level Security (RLS): enforced on `users`, `digital_assets`, and `beneficiaries`. Users can only select/insert/update/delete their own rows, checked via `auth.uid()` policies.

### Data Model (Supabase)

- `public.users`
  - id (uuid, PK) — must equal `auth.uid()`
  - email (text, unique)
  - full_name (text)
  - created_at, updated_at (timestamptz)
  - RLS: allows insert/select for individual user only.

- `public.beneficiaries`
  - id (uuid, PK)
  - user_id (uuid, FK → users.id)
  - full_name (text)
  - email (text|null)
  - phone_number (text|null)
  - notes (text|null)
  - relationship_id (integer|null, FK → relationships.id) — relationship lookup defined elsewhere
  - status (text, default `active`)
  - last_notified_at (timestamp|null), notified (boolean, default false), email_verified (boolean, default false)
  - created_at, updated_at (timestamptz)
  - RLS: select/insert/update/delete only if `auth.uid() = user_id`.

- `public.digital_assets`
  - id (uuid, PK)
  - user_id (uuid, FK → users.id)
  - asset_type (text)
  - asset_name (text)
  - beneficiary_id (uuid|null, FK → beneficiaries.id)
  - status (text, default `unassigned`)
  - email, password, website (text|null)
  - valid_until (date|null)
  - description (text|null)
  - files (jsonb|null) and number_of_files (int, default 0)
  - created_at, updated_at (timestamptz)
  - RLS: select/insert/update/delete only if `auth.uid() = user_id`.

TypeScript types: `src/lib/supabase.ts` declares a `Database` type that matches these tables for typed queries.

### Internationalization

- Library: `next-intl`.
- Routing: `src/i18n/routing.ts` defines `locales = ['en','es']`, `defaultLocale = 'es'`.
- Middleware: negotiates locale from URL and enforces redirects.
- Content: translation message files are present under `iablee-app/messages/` and `iablee-app/iablee-app/src/messages/`. The user prefers lowercase hyphen-separated keys in `@en.json` and `@es.json` [[memory:3376191]].

### App Navigation and Pages (high level)

- Auth area: `src/app/[locale]/auth/`
  - `login`, `register`, `callback`, test route
  - `auth-form.tsx` supports email/password and social sign-ins (Google/Apple functions present as stubs)

- Wizard: `src/app/[locale]/wizard/`
  - Multi-step flow (`welcome` → `asset-type` → `asset-details` → `beneficiary` → `final`)
  - Fetches relationship options, collects initial asset data, and persists when finishing.

- Dashboard: `src/app/[locale]/dashboard/`
  - Summary of user status (assets, beneficiaries) and quick actions.

- Digital Assets: `src/app/[locale]/digital-assets/`
  - List, filter, create, edit, delete assets
  - Assign beneficiary to asset; manage attachments via `AssetAttachmentsModal`
  - `AddAssetModal` uses `AddAssetForm` which is driven by `constants/assetTypes.ts` for dynamic fields and validation hints

- Beneficiaries: `src/app/[locale]/beneficiaries/`
  - List, create, update, delete beneficiaries; track verification and notification status

### UI System

- Built on Radix primitives with small wrapper components under `src/components/ui/`:
  - `button`, `card`, `dialog`, `dropdown-menu`, `form`, `input`, `label`, `select`, `scroll-area`, `textarea`, `sonner` toaster
- Composition utilities: `cn` helper; `class-variance-authority` and `tailwind-merge` for styling.
- Icons: `lucide-react`.

### Middleware Behavior (detailed)

1) Run `next-intl` middleware for locale negotiation.
2) Build Supabase middleware client with request/response.
3) Fetch session and inspect the current pathname.
4) If no session and not under `/[locale]/auth/*`, redirect to `/[locale]/auth/login` with `redirectedFrom` param.
5) If session and currently under `/[locale]/auth/*`, query for one `digital_assets` row by `user_id`. Redirect:
   - To `/[locale]/wizard` if 0 assets;
   - To `/[locale]/dashboard` otherwise.

### File Attachments (overview)

- Asset attachments managed via `AssetAttachmentsModal`:
  - Builds a list of files (with type inference and icons), supports preview and download behaviors, and upload/delete operations.
  - The `files` array is stored in the `digital_assets.files` JSONB field and `number_of_files` is kept in sync.

### Marketing Site Highlights (`iablee-site/`)

- `_config.yml` sets `lang: es`, `url: https://iablee.com`, and `alternate_languages: en`.
- `_layouts/default.html` includes:
  - GTM snippet with container `GT-MK5DRWPX` and Google Analytics `G-WQ020FXKLE` (through `analytics.html`).
  - Consent banner (`_includes/consent-banner.html`) that sets a `cookie_preferences` cookie, toggles `gtag('consent','update', ...)`, and pushes a `consent_update` event to dataLayer.
  - Navigation links to the app (`https://app.iablee.com/es/auth/login` and `/register`).
- SEO tags: `_includes/tags.html` configures og/twitter/canonical and structured data for the organization.

### Deployment and Hosting (assumptions)

- App (`iablee-app/`):
  - Deploy to a Next.js-compatible host (Vercel or similar). Ensure env vars for Supabase are set in the deployment environment.
  - Image domains configured in `next.config.ts` must be whitelisted.
  - Middleware requires Edge Runtime compatibility for best performance (default Next.js middleware environment is fine).

- Site (`iablee-site/`):
  - Jekyll 4 site: build via `bundle exec jekyll build` and serve via static hosting or GitHub Pages.
  - Ensure GTM/GA IDs are kept in secrets if templating is added later.

### Coding Conventions

- TypeScript with explicit types on exported APIs; avoid `any`.
- UI code aims for readability; prefer descriptive variable names.
- Minimal try/catch; real handling only (avoid swallowing errors).
- I18n keys: lowercase hyphen-separated per user preference [[memory:3376191]].

### Adding New Features (playbook)

1) Define the data needs:
   - If new columns/tables are required, add a Supabase migration in `iablee-app/supabase/migrations/` with RLS policies mirroring existing patterns.
   - Update `Database` types in `src/lib/supabase.ts` to match the new schema.

2) Wire product surfaces:
   - Add new routes under `src/app/[locale]/...` using the existing structure.
   - Use `middleware.ts` rules to decide if new routes require auth or public access.

3) Build UX with existing UI primitives:
   - Favor `src/components/ui/*` components and follow layout patterns in pages like digital assets and beneficiaries.
   - For multi-step setup, mirror `wizard` UX flow patterns.

4) Localize content:
   - Add keys to `messages/en.json` and `messages/es.json` with lowercase hyphen-separated naming.
   - Use `next-intl` hooks/components to load messages per locale.

5) Validate and test:
   - Ensure RLS policies allow only owners to read/write their data.
   - Confirm middleware redirects and session checks still behave as intended.
   - Add form validation with Zod and surface errors through the existing form components.

### Known IDs and Integrations

- Google Tag Manager container: `GT-MK5DRWPX` (marketing site)
- Google Analytics measurement ID: `G-WQ020FXKLE` (marketing site)

### Glossary

- Asset: A digital record (credentials, instructions, documents) that the user wants to manage and potentially share with beneficiaries.
- Beneficiary: A designated person who may receive access to specific assets.
- Wizard: First-time flow to guide users through creating their first asset and configuring beneficiaries.


