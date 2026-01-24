# Run Database Migration to Fix 400 Error

## 🚨 Problem
The wizard is getting a 400 error with "invalid input syntax for type date" because the database tables don't exist or have the wrong schema.

## ✅ Solution

### Option 1: Run Migration via Supabase Dashboard

1. **Go to your Supabase Dashboard**: [https://supabase.com/dashboard](https://supabase.com/dashboard)
2. **Select your project**
3. **Go to SQL Editor**
4. **Copy and paste this SQL**:

```sql
-- Create digital_assets table
CREATE TABLE IF NOT EXISTS public.digital_assets (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  asset_type text NOT NULL,
  asset_name text NOT NULL,
  asset_value text,
  access_instructions text,
  beneficiary_id uuid,
  status text DEFAULT 'pending',
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now())
);

-- Create beneficiaries table
CREATE TABLE IF NOT EXISTS public.beneficiaries (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  email text,
  relationship text,
  phone_number text,
  notes text,
  notified boolean DEFAULT false,
  status text DEFAULT 'pending',
  last_notified_at timestamp with time zone,
  email_verified boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now())
);

-- Enable RLS
ALTER TABLE public.digital_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.beneficiaries ENABLE ROW LEVEL SECURITY;

-- Create policies for digital_assets
CREATE POLICY "Users can view their own digital assets" ON public.digital_assets
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own digital assets" ON public.digital_assets
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own digital assets" ON public.digital_assets
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own digital assets" ON public.digital_assets
  FOR DELETE USING (auth.uid() = user_id);

-- Create policies for beneficiaries
CREATE POLICY "Users can view their own beneficiaries" ON public.beneficiaries
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own beneficiaries" ON public.beneficiaries
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own beneficiaries" ON public.beneficiaries
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own beneficiaries" ON public.beneficiaries
  FOR DELETE USING (auth.uid() = user_id);
```

5. **Click "Run"** to execute the migration

### Option 2: Use Supabase CLI (if installed)

```bash
# Install Supabase CLI if not already installed
npm install -g supabase

# Login to Supabase
supabase login

# Link your project
supabase link --project-ref YOUR_PROJECT_REF

# Push the migration
supabase db push
```

## 🧪 Test the Fix

1. **Try the wizard again**: Go to `http://localhost:3000/en/wizard`
2. **Fill out the forms** and click "Finish"
3. **Check the browser console** for any errors
4. **Verify the data** appears in your dashboard

## 📝 What This Fixes

- ✅ **Creates the missing tables** (`digital_assets` and `beneficiaries`)
- ✅ **Sets up proper date fields** with default values
- ✅ **Enables Row Level Security** for data protection
- ✅ **Creates access policies** so users can only see their own data
- ✅ **Fixes the date syntax error** by providing proper defaults 