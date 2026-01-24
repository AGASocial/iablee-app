-- Create digital_assets table (matching existing schema)
CREATE TABLE IF NOT EXISTS public.digital_assets (
  id uuid not null default gen_random_uuid (),
  user_id uuid not null,
  asset_type text not null,
  asset_name text not null,
  beneficiary_id uuid null,
  status text null default 'unassigned'::text,
  email text null,
  password text null,
  website text null,
  valid_until date null,
  description text null,
  files jsonb null,
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  number_of_files integer null default 0,
  constraint digital_assets_pkey primary key (id),
  constraint digital_assets_beneficiary_id_fkey foreign KEY (beneficiary_id) references beneficiaries (id),
  constraint digital_assets_user_id_fkey foreign KEY (user_id) references users (id)
) TABLESPACE pg_default;

-- Create beneficiaries table (matching actual schema)
CREATE TABLE IF NOT EXISTS public.beneficiaries (
  id uuid not null default gen_random_uuid (),
  user_id uuid not null,
  full_name text not null,
  email text null,
  phone_number text null,
  notes text null,
  last_notified_at timestamp without time zone null,
  relationship_id integer null,
  status text null default 'active'::text,
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  notified boolean null default false,
  email_verified boolean null default false,
  constraint beneficiaries_pkey primary key (id),
  constraint beneficiaries_relationship_id_fkey foreign KEY (relationship_id) references relationships (id),
  constraint beneficiaries_user_id_fkey foreign KEY (user_id) references users (id)
) TABLESPACE pg_default;

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