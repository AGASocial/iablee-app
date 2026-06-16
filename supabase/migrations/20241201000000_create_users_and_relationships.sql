-- Base tables required before digital_assets and beneficiaries (20250101).
-- Run this first on a fresh Supabase project.

-- public.users (must exist before digital_assets and beneficiaries FKs)
CREATE TABLE IF NOT EXISTS public.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  full_name text,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow individual user inserts" ON public.users
  FOR INSERT
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Allow individual user access" ON public.users
  FOR SELECT
  USING (auth.uid() = id);

-- public.relationships (referenced by beneficiaries.relationship_id)
CREATE TABLE IF NOT EXISTS public.relationships (
  id serial PRIMARY KEY,
  key text NOT NULL UNIQUE,
  generation_level integer NOT NULL DEFAULT 3
);

ALTER TABLE public.relationships ENABLE ROW LEVEL SECURITY;

-- Read-only for authenticated users (used by wizard and beneficiary forms)
CREATE POLICY "Authenticated users can view relationships" ON public.relationships
  FOR SELECT
  USING (auth.role() = 'authenticated');

-- Seed relationship options (keys match i18n: messages/*.json "relationships.*")
INSERT INTO public.relationships (key, generation_level) VALUES
  ('spouse', 1),
  ('son', 2),
  ('daughter', 2),
  ('grandchild', 2),
  ('father', 3),
  ('mother', 3),
  ('brother', 3),
  ('sister', 3),
  ('grandfather', 4),
  ('grandmother', 4),
  ('father-in-law', 3),
  ('mother-in-law', 3),
  ('stepbrother', 3),
  ('stepsister', 3),
  ('stepfather', 3),
  ('stepmother', 3),
  ('aunt', 4),
  ('uncle', 4),
  ('niece', 4),
  ('nephew', 4),
  ('cousin', 4),
  ('friend', 3),
  ('other', 5)
ON CONFLICT (key) DO NOTHING;
