-- Create asset_types table to store asset type definitions/templates
-- This is separate from digital_assets which stores user-created asset instances
CREATE TABLE IF NOT EXISTS public.asset_types (
  id uuid not null default gen_random_uuid(),
  key text not null unique,
  name text not null,
  description text null,
  icon text not null, -- Lucide icon name (e.g., 'Mail', 'Mic', 'Camera')
  is_active boolean not null default true, -- Controls whether this asset type is shown/available
  required_fields jsonb not null default '[]'::jsonb, -- Array of required field names
  optional_fields jsonb not null default '[]'::jsonb, -- Array of optional field names
  file_accept text null, -- File type restrictions (e.g., 'audio/*', 'image/*', '*')
  custom_fields jsonb not null default '[]'::jsonb, -- Array of custom field definitions with type, label, etc.
  display_order integer not null default 0, -- For sorting asset types in UI
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint asset_types_pkey primary key (id),
  constraint asset_types_key_unique unique (key)
) TABLESPACE pg_default;

-- Create junction table for many-to-many relationship between asset_types and billing_plans
-- This allows different asset types to be available in different billing plans
CREATE TABLE IF NOT EXISTS public.asset_type_billing_plans (
  id uuid not null default gen_random_uuid(),
  asset_type_id uuid not null,
  billing_plan_id text not null,
  created_at timestamp with time zone not null default now(),
  constraint asset_type_billing_plans_pkey primary key (id),
  constraint asset_type_billing_plans_asset_type_id_fkey foreign key (asset_type_id) references asset_types (id) on delete cascade,
  constraint asset_type_billing_plans_billing_plan_id_fkey foreign key (billing_plan_id) references billing_plans (id) on delete cascade,
  constraint asset_type_billing_plans_unique unique (asset_type_id, billing_plan_id)
) TABLESPACE pg_default;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS asset_types_is_active_idx ON public.asset_types (is_active);
CREATE INDEX IF NOT EXISTS asset_types_display_order_idx ON public.asset_types (display_order);
CREATE INDEX IF NOT EXISTS asset_type_billing_plans_asset_type_id_idx ON public.asset_type_billing_plans (asset_type_id);
CREATE INDEX IF NOT EXISTS asset_type_billing_plans_billing_plan_id_idx ON public.asset_type_billing_plans (billing_plan_id);

-- Enable RLS
ALTER TABLE public.asset_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_type_billing_plans ENABLE ROW LEVEL SECURITY;

-- RLS Policies for asset_types (read-only for all authenticated users)
CREATE POLICY "Authenticated users can view active asset types" ON public.asset_types
  FOR SELECT
  USING (auth.role() = 'authenticated' AND is_active = true);

-- Allow service role to manage asset types (for admin operations)
CREATE POLICY "Service role can manage asset types" ON public.asset_types
  FOR ALL
  USING (auth.role() = 'service_role');

-- RLS Policies for asset_type_billing_plans (read-only for authenticated users)
CREATE POLICY "Authenticated users can view asset type billing plan relationships" ON public.asset_type_billing_plans
  FOR SELECT
  USING (auth.role() = 'authenticated');

-- Allow service role to manage relationships (for admin operations)
CREATE POLICY "Service role can manage asset type billing plan relationships" ON public.asset_type_billing_plans
  FOR ALL
  USING (auth.role() = 'service_role');

-- Create triggers for updated_at
CREATE TRIGGER set_asset_types_updated_at
  BEFORE UPDATE ON public.asset_types
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- Insert initial asset types based on the ASSET_TYPES constant
INSERT INTO public.asset_types (key, name, description, icon, required_fields, optional_fields, file_accept, custom_fields, display_order) VALUES
  ('letter', 'assets.letter.name', 'assets.letter.description', 'Mail', '["asset_name"]'::jsonb, '["description"]'::jsonb, '*', '[{"key": "message_content", "label": "writeWhatYouWantToSay", "type": "textarea", "required": true}]'::jsonb, 1),
  ('audio', 'assets.audio.name', 'assets.audio.description', 'Mic', '["asset_name"]'::jsonb, '[]'::jsonb, 'audio/*', '[{"key": "audio_note", "label": "recordHereOrUpload", "type": "file", "required": true}]'::jsonb, 2),
  ('photo', 'assets.photo.name', 'assets.photo.description', 'Camera', '["asset_name"]'::jsonb, '[]'::jsonb, 'image/*', '[{"key": "photo_caption", "label": "photoCaption", "type": "text", "required": false}]'::jsonb, 3),
  ('video', 'assets.video.name', 'assets.video.description', 'Video', '["asset_name"]'::jsonb, '[]'::jsonb, 'video/*', '[{"key": "video_caption", "label": "videoCaption", "type": "text", "required": false}]'::jsonb, 4),
  ('document', 'assets.document.name', 'assets.document.description', 'File', '["asset_name"]'::jsonb, '["description"]'::jsonb, '*', '[{"key": "document_type", "label": "documentType", "type": "select", "required": true, "options": ["identification", "passport", "certificate", "contract", "invoice", "receipt", "other"]}, {"key": "observations", "label": "observations", "type": "textarea", "required": false}]'::jsonb, 5)
ON CONFLICT (key) DO NOTHING;

-- Associate asset types with billing plans
-- All asset types are available in Necessary and Premium plans
-- Free plan gets limited access (only cartas, fotos, documentos)
INSERT INTO public.asset_type_billing_plans (asset_type_id, billing_plan_id) VALUES
  -- Free plan (limited asset types)
  ((SELECT id FROM asset_types WHERE key = 'letter'), 'plan_free'),
  ((SELECT id FROM asset_types WHERE key = 'audio'), 'plan_free'),
  ((SELECT id FROM asset_types WHERE key = 'photo'), 'plan_free'),
  ((SELECT id FROM asset_types WHERE key = 'video'), 'plan_free'),
  ((SELECT id FROM asset_types WHERE key = 'document'), 'plan_free'),

  -- Necessary plans (all asset types)
  ((SELECT id FROM asset_types WHERE key = 'letter'), 'plan_necessary_month'),
  ((SELECT id FROM asset_types WHERE key = 'audio'), 'plan_necessary_month'),
  ((SELECT id FROM asset_types WHERE key = 'photo'), 'plan_necessary_month'),
  ((SELECT id FROM asset_types WHERE key = 'video'), 'plan_necessary_month'),
  ((SELECT id FROM asset_types WHERE key = 'document'), 'plan_necessary_month'),

  ((SELECT id FROM asset_types WHERE key = 'letter'), 'plan_necessary_year'),
  ((SELECT id FROM asset_types WHERE key = 'audio'), 'plan_necessary_year'),
  ((SELECT id FROM asset_types WHERE key = 'photo'), 'plan_necessary_year'),
  ((SELECT id FROM asset_types WHERE key = 'video'), 'plan_necessary_year'),
  ((SELECT id FROM asset_types WHERE key = 'document'), 'plan_necessary_year'),

  -- Premium plans (all asset types)
  ((SELECT id FROM asset_types WHERE key = 'letter'), 'plan_premium_month'),
  ((SELECT id FROM asset_types WHERE key = 'audio'), 'plan_premium_month'),
  ((SELECT id FROM asset_types WHERE key = 'photo'), 'plan_premium_month'),
  ((SELECT id FROM asset_types WHERE key = 'video'), 'plan_premium_month'),
  ((SELECT id FROM asset_types WHERE key = 'document'), 'plan_premium_month'),

  ((SELECT id FROM asset_types WHERE key = 'letter'), 'plan_premium_year'),
  ((SELECT id FROM asset_types WHERE key = 'audio'), 'plan_premium_year'),
  ((SELECT id FROM asset_types WHERE key = 'photo'), 'plan_premium_year'),
  ((SELECT id FROM asset_types WHERE key = 'video'), 'plan_premium_year'),
  ((SELECT id FROM asset_types WHERE key = 'document'), 'plan_premium_year')
ON CONFLICT (asset_type_id, billing_plan_id) DO NOTHING;
