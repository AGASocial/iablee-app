-- US-B-010: Database indexes and RLS hardening
-- Phase 0 performance plan — indexes, security_otps RLS, users PIN columns

-- T-B-010-6: Version-control missing columns (encrypted_storage_key, pin hash)
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS encrypted_storage_key text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS security_pin_hash text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS security_pin_updated_at timestamptz;

-- T-B-010-1: Indexes on digital_assets, beneficiaries, asset_attachments
CREATE INDEX IF NOT EXISTS digital_assets_user_id_idx
  ON public.digital_assets (user_id);

CREATE INDEX IF NOT EXISTS digital_assets_user_id_asset_name_idx
  ON public.digital_assets (user_id, asset_name);

CREATE INDEX IF NOT EXISTS beneficiaries_user_id_idx
  ON public.beneficiaries (user_id);

CREATE INDEX IF NOT EXISTS beneficiaries_user_id_full_name_idx
  ON public.beneficiaries (user_id, full_name);

CREATE INDEX IF NOT EXISTS asset_attachments_asset_id_idx
  ON public.asset_attachments (asset_id);

-- T-B-010-2: Composite index for subscription status lookups
CREATE INDEX IF NOT EXISTS billing_subscriptions_user_id_status_idx
  ON public.billing_subscriptions (user_id, status);

-- T-B-010-3: security_otps RLS + indexes + expiry cleanup
ALTER TABLE public.security_otps ENABLE ROW LEVEL SECURITY;

-- OTPs are managed server-side only; deny direct client access
CREATE POLICY "Deny client access to security_otps" ON public.security_otps
  FOR ALL
  USING (false);

CREATE INDEX IF NOT EXISTS security_otps_user_verified_expires_idx
  ON public.security_otps (user_id, verified, expires_at);

CREATE OR REPLACE FUNCTION public.cleanup_expired_security_otps()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM public.security_otps
  WHERE expires_at < now() - interval '1 day';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

-- T-B-010-4: users UPDATE policy for security_pin columns
DROP POLICY IF EXISTS "Allow individual user updates" ON public.users;
CREATE POLICY "Allow individual user updates" ON public.users
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- T-B-010-5: Optimize asset_attachments RLS (EXISTS vs IN subquery)
DROP POLICY IF EXISTS "Users can view attachments of their own assets" ON public.asset_attachments;
DROP POLICY IF EXISTS "Users can insert attachments for their own assets" ON public.asset_attachments;
DROP POLICY IF EXISTS "Users can delete attachments of their own assets" ON public.asset_attachments;

CREATE POLICY "Users can view attachments of their own assets" ON public.asset_attachments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.digital_assets da
      WHERE da.id = asset_id AND da.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert attachments for their own assets" ON public.asset_attachments
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.digital_assets da
      WHERE da.id = asset_id AND da.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete attachments of their own assets" ON public.asset_attachments
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.digital_assets da
      WHERE da.id = asset_id AND da.user_id = auth.uid()
    )
  );
