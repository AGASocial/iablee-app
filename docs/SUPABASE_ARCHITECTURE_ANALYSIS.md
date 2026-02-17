# Supabase Architecture Analysis

## Executive Summary

This analysis examines how Supabase is used in the iablee-app project. **The anon_key IS being used**, but only on the frontend for direct Supabase client calls. The backend API routes exclusively use the `SUPABASE_SERVICE_ROLE_KEY`. The architecture is **mixed**: the frontend makes both direct Supabase calls AND REST API calls.

---

## Key Findings

### ✅ Anon Key Usage
- **IS USED** on the frontend via `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- Used to create the Supabase client component: `createClientComponentClient()`
- Located in: `src/lib/supabase.ts`

### ✅ Service Role Key Usage
- **IS USED** on the backend via `SUPABASE_SERVICE_ROLE_KEY`
- Used in:
  - API routes (`/api/billing/*`, `/api/subscription/*`)
  - Middleware (`src/middleware.ts`)
  - Server-side operations

---

## Architecture Breakdown

### 1. Frontend Direct Supabase Calls (Using Anon Key)

The frontend makes **direct Supabase client calls** using the anon key for:

#### Authentication Operations
- **File**: `src/components/auth/auth-form.tsx`
- Operations:
  - `supabase.auth.signUp()`
  - `supabase.auth.signInWithPassword()`
  - `supabase.auth.signInWithOAuth()` (Google, Apple)
  - `supabase.auth.getUser()`

#### Database Operations
- **File**: `src/app/[locale]/digital-assets/page.tsx`
  - `supabase.from('digital_assets').select()`
  - `supabase.from('digital_assets').delete()`
  - `supabase.from('digital_assets').update()`
  - `supabase.from('beneficiaries').select()`

- **File**: `src/app/[locale]/beneficiaries/page.tsx`
  - `supabase.from('beneficiaries').select()`
  - `supabase.from('beneficiaries').delete()`
  - `supabase.from('beneficiaries').update()`
  - `supabase.from('beneficiaries').insert()`

- **File**: `src/app/[locale]/wizard/page.tsx`
  - `supabase.from('relationships').select()`
  - `supabase.from('digital_assets').insert()`
  - `supabase.from('beneficiaries').insert()`

#### Storage Operations
- **File**: `src/components/AddAssetForm.tsx`
  - `supabase.storage.from('assets').upload()`

- **File**: `src/components/AssetAttachmentsModal.tsx`
  - `supabase.storage.from('assets').upload()`
  - `supabase.storage.from('assets').getPublicUrl()`
  - `supabase.storage.from('assets').download()`
  - `supabase.storage.from('assets').remove()`

#### Asset Type Operations
- **File**: `src/lib/assetTypes.ts`
  - `supabase.from('asset_types').select()`
  - `supabase.from('asset_type_billing_plans').select()`
  - `supabase.from('billing_subscriptions').select()`

### 2. Frontend REST API Calls (No Direct Supabase)

The frontend makes REST API calls to Next.js API routes for:

#### Billing Operations
- **File**: `src/app/[locale]/billing/page.tsx`
  - `fetch('/api/billing/subscriptions')`
  - `fetch('/api/billing/invoices')`

- **File**: `src/app/[locale]/billing/plans/page.tsx`
  - `fetch('/api/billing/subscriptions')`
  - `fetch('/api/billing/plans')`
  - `fetch('/api/billing/payment-methods')`

- **File**: `src/components/billing/PaymentMethodsList.tsx`
  - `fetch('/api/billing/payment-methods')`

- **File**: `src/components/billing/AddPaymentMethodForm.tsx`
  - `fetch('/api/billing/payment-methods')`

#### Subscription Operations
- **File**: `src/app/[locale]/digital-assets/page.tsx`
  - `fetch('/api/subscription/check-limit?type=asset')`

- **File**: `src/app/[locale]/beneficiaries/page.tsx`
  - `fetch('/api/subscription/check-limit?type=beneficiary')`

### 3. Backend API Routes (Using Service Role Key)

All API routes use `SUPABASE_SERVICE_ROLE_KEY`:

#### Billing API Routes
- **File**: `src/app/api/billing/plans/route.ts`
  - Uses service role key to fetch `billing_plans`

- **File**: `src/app/api/billing/subscriptions/route.ts`
  - Uses `getBillingService()` which uses service role key

- **File**: `src/app/api/billing/payment-methods/route.ts`
  - Uses `getBillingService()` which uses service role key

- **File**: `src/app/api/billing/invoices/route.ts`
  - Uses `getBillingService()` which uses service role key

#### Subscription API Routes
- **File**: `src/app/api/subscription/status/route.ts`
  - Creates client with service role key
  - Verifies auth token from cookies

- **File**: `src/app/api/subscription/check-limit/route.ts`
  - Uses service role key for database queries

#### Webhook Routes
- **File**: `src/app/api/webhooks/stripe/route.ts`
  - Uses service role key for webhook processing

### 4. Middleware (Using Service Role Key)

- **File**: `src/middleware.ts`
  - Uses `SUPABASE_SERVICE_ROLE_KEY` to:
    - Verify authentication tokens from cookies
    - Check user session
    - Query `digital_assets` table for redirect logic

---

## Environment Variables

### Frontend (Public)
- `NEXT_PUBLIC_SUPABASE_URL` - Used by frontend Supabase client
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Used by frontend Supabase client

### Backend (Private)
- `SUPABASE_SERVICE_ROLE_KEY` - Used by:
  - API routes
  - Middleware
  - Server-side operations

---

## Security Implications

### ✅ Current Security Model

1. **RLS (Row Level Security)**: The frontend uses anon key, which means all database operations are subject to RLS policies. This is the correct approach for direct client access.

2. **Service Role Key**: Backend operations use service role key, which bypasses RLS. This is appropriate for:
   - Admin operations
   - Webhook processing
   - Middleware authentication checks

### ⚠️ Potential Concerns

1. **Mixed Architecture**: Having both direct Supabase calls and REST API calls can lead to:
   - Inconsistent error handling
   - Different authentication mechanisms
   - Harder to maintain

2. **Anon Key Exposure**: The anon key is exposed in the frontend bundle. While this is expected behavior, it means:
   - All RLS policies must be correctly configured
   - No sensitive operations should rely solely on the anon key

3. **Direct Database Access**: Frontend components directly query the database, which means:
   - RLS policies must be comprehensive
   - Business logic is split between frontend and backend

---

## Recommendations

### Option 1: Keep Current Architecture (Recommended for Now)
- **Pros**: 
  - Already working
  - Direct Supabase calls are fast
  - RLS provides security layer
- **Cons**: 
  - Mixed patterns
  - Business logic in frontend

### Option 2: Migrate to Full REST API Pattern
- **Pros**:
  - Consistent architecture
  - All business logic in backend
  - Easier to maintain
  - Better error handling
- **Cons**:
  - More API routes to create
  - Slightly more latency
  - More code to maintain

### Option 3: Hybrid Approach (Current + Improvements)
- Keep direct Supabase calls for:
  - Simple CRUD operations (with RLS)
  - Storage operations
  - Authentication
- Use REST API for:
  - Complex business logic
  - Billing/subscription operations
  - Operations requiring service role key

---

## Code Examples

### Frontend Direct Supabase Call
```typescript
// src/app/[locale]/digital-assets/page.tsx
const { data: { user } } = await supabase.auth.getUser();
const { data } = await supabase
  .from('digital_assets')
  .select('*')
  .eq('user_id', user?.id);
```

### Frontend REST API Call
```typescript
// src/app/[locale]/digital-assets/page.tsx
const response = await fetch('/api/subscription/check-limit?type=asset');
const result = await response.json();
```

### Backend API Route (Service Role)
```typescript
// src/app/api/billing/plans/route.ts
const supabase = createClient(supabaseUrl, supabaseServiceKey);
const { data: plans } = await supabase
  .from('billing_plans')
  .select('*');
```

---

## Conclusion

**The anon_key IS being used** on the frontend for direct Supabase client calls. The architecture is **mixed**:
- Frontend uses direct Supabase calls (anon key) for most operations
- Frontend uses REST API calls for billing/subscription operations
- Backend uses service role key for all API routes

This is a valid architecture, but it's important to:
1. Ensure RLS policies are comprehensive
2. Keep business logic consistent
3. Consider migrating to a more unified pattern if the project grows

---

## Files Summary

### Frontend Files Using Supabase Directly (Anon Key)
- `src/lib/supabase.ts` - Client initialization
- `src/components/auth/auth-form.tsx` - Authentication
- `src/app/[locale]/digital-assets/page.tsx` - Asset management
- `src/app/[locale]/beneficiaries/page.tsx` - Beneficiary management
- `src/app/[locale]/wizard/page.tsx` - Wizard flow
- `src/components/AddAssetForm.tsx` - Asset creation
- `src/components/AssetAttachmentsModal.tsx` - File management
- `src/lib/assetTypes.ts` - Asset type queries

### Backend Files Using Service Role Key
- `src/middleware.ts` - Session verification
- `src/app/api/billing/plans/route.ts`
- `src/app/api/billing/subscriptions/route.ts`
- `src/app/api/billing/payment-methods/route.ts`
- `src/app/api/billing/invoices/route.ts`
- `src/app/api/subscription/status/route.ts`
- `src/app/api/subscription/check-limit/route.ts`
- `src/app/api/webhooks/stripe/route.ts`
- `src/lib/billing/server.ts` - Billing service

---

*Analysis Date: 2025-01-27*
*Project: iablee-app*

