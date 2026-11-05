-- Stop authenticated clients from writing security_pin_hash or forging
-- beneficiaries.email_verified. PIN reset codes are stored as HMAC digests.
-- Outstanding plaintext OTPs are destroyed.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS pin_reset_failed_attempts integer NOT NULL DEFAULT 0;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS pin_reset_locked_until timestamptz;

COMMENT ON COLUMN public.security_otps.code IS
  'HMAC-SHA256 hex of the PIN reset code. Never store the plaintext code.';

-- Destroy any plaintext or still-active OTPs from before hashed storage.
UPDATE public.security_otps
SET
  code = md5(id::text || clock_timestamp()::text),
  verified = true,
  expires_at = now()
WHERE verified IS DISTINCT FROM true
   OR char_length(code) <> 64;

-- Role from the PostgREST JWT. current_user alone is not enough: service_role
-- requests are authenticated by the JWT claim after SET ROLE.
CREATE OR REPLACE FUNCTION public.request_role()
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  claims text;
  jwt_role text;
BEGIN
  jwt_role := nullif(current_setting('request.jwt.claim.role', true), '');
  IF jwt_role IS NOT NULL THEN
    RETURN jwt_role;
  END IF;

  claims := nullif(current_setting('request.jwt.claims', true), '');
  IF claims IS NOT NULL THEN
    BEGIN
      jwt_role := nullif(claims::json ->> 'role', '');
      IF jwt_role IS NOT NULL THEN
        RETURN jwt_role;
      END IF;
    EXCEPTION
      WHEN invalid_text_representation THEN
        jwt_role := NULL;
    END;
  END IF;

  IF current_user = 'service_role' THEN
    RETURN 'service_role';
  END IF;

  RETURN coalesce(current_user, '');
END;
$$;

REVOKE ALL ON FUNCTION public.request_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_role() TO anon, authenticated, service_role;

-- Table-level UPDATE would ignore a column-only REVOKE, so drop table UPDATE
-- and grant back the columns the app still updates as the signed-in user.
REVOKE UPDATE ON TABLE public.users FROM PUBLIC, anon, authenticated;
GRANT UPDATE (full_name, email, updated_at) ON TABLE public.users TO authenticated;
GRANT UPDATE ON TABLE public.users TO service_role;

CREATE OR REPLACE FUNCTION public.protect_security_pin_hash()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  actor text;
BEGIN
  actor := public.request_role();

  IF TG_OP = 'INSERT' THEN
    IF NEW.security_pin_hash IS NOT NULL AND actor IS DISTINCT FROM 'service_role' THEN
      RAISE EXCEPTION 'security_pin_hash can only be written by service_role'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF actor IS DISTINCT FROM 'service_role'
     AND (
       NEW.security_pin_hash IS DISTINCT FROM OLD.security_pin_hash
       OR NEW.security_pin_updated_at IS DISTINCT FROM OLD.security_pin_updated_at
     ) THEN
    RAISE EXCEPTION 'security_pin_hash can only be written by service_role'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_security_pin_hash() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.protect_security_pin_hash() TO anon, authenticated, service_role;

DROP TRIGGER IF EXISTS users_protect_security_pin_hash ON public.users;
CREATE TRIGGER users_protect_security_pin_hash
  BEFORE INSERT OR UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_security_pin_hash();

-- Drop verification flags that were never confirmed through a used token.
UPDATE public.beneficiaries b
SET
  email_verified = false,
  email_verified_at = NULL
WHERE coalesce(b.email_verified, false) = true
  AND NOT EXISTS (
    SELECT 1
    FROM public.beneficiary_email_verifications v
    WHERE v.beneficiary_id = b.id
      AND v.used_at IS NOT NULL
  );

CREATE OR REPLACE FUNCTION public.protect_beneficiary_email_verified()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  actor text;
  email_changed boolean;
BEGIN
  actor := public.request_role();

  IF TG_OP = 'INSERT' THEN
    IF actor IS DISTINCT FROM 'service_role' THEN
      NEW.email_verified := false;
      NEW.email_verified_at := NULL;
    END IF;
    RETURN NEW;
  END IF;

  email_changed := lower(btrim(coalesce(NEW.email, '')))
    IS DISTINCT FROM lower(btrim(coalesce(OLD.email, '')));

  IF email_changed THEN
    NEW.email_verified := false;
    NEW.email_verified_at := NULL;
    RETURN NEW;
  END IF;

  -- Non-service writers cannot turn verification on. A flag already set by
  -- service_role stays when the email did not change, so editing notes does
  -- not wipe a real verification. Clearing it (true -> false) is allowed.
  IF actor IS DISTINCT FROM 'service_role' THEN
    IF NOT coalesce(OLD.email_verified, false) THEN
      NEW.email_verified := false;
      NEW.email_verified_at := NULL;
    ELSIF NOT coalesce(NEW.email_verified, false) THEN
      NEW.email_verified := false;
      NEW.email_verified_at := NULL;
    ELSE
      NEW.email_verified := true;
      NEW.email_verified_at := OLD.email_verified_at;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_beneficiary_email_verified() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.protect_beneficiary_email_verified() TO anon, authenticated, service_role;

DROP TRIGGER IF EXISTS beneficiaries_protect_email_verified ON public.beneficiaries;
CREATE TRIGGER beneficiaries_protect_email_verified
  BEFORE INSERT OR UPDATE ON public.beneficiaries
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_beneficiary_email_verified();

-- Stored emails may include surrounding spaces. Match the same normalization
-- the API applies to the session email.
CREATE INDEX IF NOT EXISTS beneficiaries_lower_trim_email_verified_idx
  ON public.beneficiaries (lower(btrim(email)))
  WHERE email_verified = true AND email IS NOT NULL;

CREATE OR REPLACE FUNCTION public.get_my_beneficiary_relationships(p_email text)
RETURNS TABLE (
  holder_full_name text,
  relationship_key text,
  beneficiary_id uuid,
  email_verified_at timestamp with time zone,
  created_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_email IS NULL OR length(trim(p_email)) = 0 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    u.full_name AS holder_full_name,
    r.key AS relationship_key,
    b.id AS beneficiary_id,
    b.email_verified_at,
    b.created_at
  FROM public.beneficiaries b
  JOIN public.users u ON u.id = b.user_id
  LEFT JOIN public.relationships r ON r.id = b.relationship_id
  WHERE lower(btrim(b.email)) = lower(btrim(p_email))
    AND b.email_verified = true
  ORDER BY b.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_beneficiary_relationships(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_beneficiary_relationships(text) FROM anon;
REVOKE ALL ON FUNCTION public.get_my_beneficiary_relationships(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_beneficiary_relationships(text) TO service_role;
