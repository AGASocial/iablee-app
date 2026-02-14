-- Create asset_attachments table
CREATE TABLE IF NOT EXISTS public.asset_attachments (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    asset_id UUID NOT NULL REFERENCES public.digital_assets(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_type TEXT NOT NULL DEFAULT 'other',
    file_size BIGINT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable Row Level Security
ALTER TABLE public.asset_attachments ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can view attachments of their own assets" ON public.asset_attachments
    FOR SELECT USING (
        auth.uid() IN (
            SELECT user_id FROM public.digital_assets WHERE id = asset_id
        )
    );

CREATE POLICY "Users can insert attachments for their own assets" ON public.asset_attachments
    FOR INSERT WITH CHECK (
        auth.uid() IN (
            SELECT user_id FROM public.digital_assets WHERE id = asset_id
        )
    );

CREATE POLICY "Users can delete attachments of their own assets" ON public.asset_attachments
    FOR DELETE USING (
        auth.uid() IN (
            SELECT user_id FROM public.digital_assets WHERE id = asset_id
        )
    );

-- Migrate existing data from digital_assets.files (assuming it's a JSONB array of strings)
-- We'll just migrate the paths. File size/type might be unknown for now, we'll try to infer type from name.
DO $$
DECLARE
    r RECORD;
    f TEXT;
    fname TEXT;
    ftype TEXT;
BEGIN
    FOR r IN SELECT id, files FROM public.digital_assets WHERE files IS NOT NULL AND jsonb_array_length(files) > 0 LOOP
        FOR f IN SELECT * FROM jsonb_array_elements_text(r.files) LOOP
            fname := split_part(f, '/', array_length(string_to_array(f, '/'), 1));
            -- Simple inference for type
            IF fname ~* '\.(jpg|jpeg|png|gif|webp)$' THEN ftype := 'image';
            ELSIF fname ~* '\.(pdf|doc|docx|txt)$' THEN ftype := 'document';
            ELSIF fname ~* '\.(mp4|mov|avi)$' THEN ftype := 'video';
            ELSIF fname ~* '\.(mp3|wav)$' THEN ftype := 'audio';
            ELSE ftype := 'other';
            END IF;

            INSERT INTO public.asset_attachments (asset_id, file_path, file_name, file_type)
            VALUES (r.id, f, fname, ftype);
        END LOOP;
    END LOOP;
END $$;
