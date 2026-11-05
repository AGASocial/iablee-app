-- Follow-up to 20261104180000. Does not change that migration.
--
-- Authenticated clients must not read security_pin_hash. A table-level
-- SELECT grant ignores a column-only REVOKE, so SELECT is revoked and
-- granted back without that column.
--
-- Failed PIN and PIN-reset attempts increment in one UPDATE. Reset cookies
-- carry a single-use grant id stored on security_otps and consumed when the
-- new PIN is written. Open beneficiary verification rows are closed when the
-- beneficiary email changes, and the relationship RPC refuses non-service roles.

ALTER TABLE public.security_otps
  ADD COLUMN IF NOT EXISTS reset_grant_id uuid;

ALTER TABLE public.security_otps
  ADD COLUMN IF NOT EXISTS reset_grant_consumed_at timestamptz;

COMMENT ON COLUMN public.security_otps.reset_grant_id IS
  'Single-use id embedded in the pin_reset session. Consumed by apply_pin_reset.';

CREATE UNIQUE INDEX IF NOT EXISTS security_otps_reset_grant_id_idx
  ON public.security_otps (reset_grant_id)
  WHERE reset_grant_id IS NOT NULL;

ALTER TABLE public.beneficiary_email_verifications
  ADD COLUMN IF NOT EXISTS email text;

COMMENT ON COLUMN public.beneficiary_email_verifications.email IS
  'Normalized recipient email at send time. Verification must match beneficiaries.email.';

-- Column-level REVOKE does not override a table-level GRANT.
REVOKE SELECT ON TABLE public.users FROM PUBLIC, anon, authenticated;

GRANT SELECT (
  id,
  email,
  full_name,
  created_at,
  updated_at,
  encrypted_storage_key,
  security_pin_updated_at,
  pin_failed_attempts,
  pin_locked_until,
  pin_reset_failed_attempts,
  pin_reset_locked_until
) ON TABLE public.users TO authenticated;

GRANT SELECT ON TABLE public.users TO service_role;

CREATE OR REPLACE FUNCTION public.user_has_security_pin(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.request_role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'user_has_security_pin is service_role only'
      USING ERRCODE = '42501';
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.users
    WHERE id = p_user_id
      AND security_pin_hash IS NOT NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION public.user_has_security_pin(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_has_security_pin(uuid) TO service_role;

-- 5 attempts and 15 minutes match src/lib/pin-lockout.ts.
CREATE OR REPLACE FUNCTION public.record_pin_failed_attempt(p_user_id uuid)
RETURNS TABLE (
  failed_attempts integer,
  locked_until timestamptz,
  already_locked boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.request_role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'record_pin_failed_attempt is service_role only'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH updated AS (
    UPDATE public.users
    SET
      pin_failed_attempts = CASE
        WHEN pin_locked_until IS NOT NULL AND pin_locked_until <= now() THEN 1
        ELSE pin_failed_attempts + 1
      END,
      pin_locked_until = CASE
        WHEN (
          CASE
            WHEN pin_locked_until IS NOT NULL AND pin_locked_until <= now() THEN 1
            ELSE pin_failed_attempts + 1
          END
        ) >= 5 THEN now() + interval '15 minutes'
        ELSE NULL
      END
    WHERE id = p_user_id
      AND (pin_locked_until IS NULL OR pin_locked_until <= now())
    RETURNING pin_failed_attempts, pin_locked_until
  )
  SELECT
    updated.pin_failed_attempts,
    updated.pin_locked_until,
    false::boolean
  FROM updated
  UNION ALL
  SELECT
    u.pin_failed_attempts,
    u.pin_locked_until,
    true::boolean
  FROM public.users u
  WHERE u.id = p_user_id
    AND NOT EXISTS (SELECT 1 FROM updated)
    AND u.pin_locked_until IS NOT NULL
    AND u.pin_locked_until > now();
END;
$$;

REVOKE ALL ON FUNCTION public.record_pin_failed_attempt(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_pin_failed_attempt(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.record_pin_reset_failed_attempt(p_user_id uuid)
RETURNS TABLE (
  failed_attempts integer,
  locked_until timestamptz,
  already_locked boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.request_role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'record_pin_reset_failed_attempt is service_role only'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH updated AS (
    UPDATE public.users
    SET
      pin_reset_failed_attempts = CASE
        WHEN pin_reset_locked_until IS NOT NULL AND pin_reset_locked_until <= now() THEN 1
        ELSE pin_reset_failed_attempts + 1
      END,
      pin_reset_locked_until = CASE
        WHEN (
          CASE
            WHEN pin_reset_locked_until IS NOT NULL AND pin_reset_locked_until <= now() THEN 1
            ELSE pin_reset_failed_attempts + 1
          END
        ) >= 5 THEN now() + interval '15 minutes'
        ELSE NULL
      END
    WHERE id = p_user_id
      AND (pin_reset_locked_until IS NULL OR pin_reset_locked_until <= now())
    RETURNING pin_reset_failed_attempts, pin_reset_locked_until
  )
  SELECT
    updated.pin_reset_failed_attempts,
    updated.pin_reset_locked_until,
    false::boolean
  FROM updated
  UNION ALL
  SELECT
    u.pin_reset_failed_attempts,
    u.pin_reset_locked_until,
    true::boolean
  FROM public.users u
  WHERE u.id = p_user_id
    AND NOT EXISTS (SELECT 1 FROM updated)
    AND u.pin_reset_locked_until IS NOT NULL
    AND u.pin_reset_locked_until > now();
END;
$$;

REVOKE ALL ON FUNCTION public.record_pin_reset_failed_attempt(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_pin_reset_failed_attempt(uuid) TO service_role;

-- Writes the new hash and consumes the grant in one transaction.
-- A failure rolls back the consume, so the grant is single-use only after success.
CREATE OR REPLACE FUNCTION public.apply_pin_reset(
  p_user_id uuid,
  p_grant_id uuid,
  p_pin_hash text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_otp_id uuid;
BEGIN
  IF public.request_role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'apply_pin_reset is service_role only'
      USING ERRCODE = '42501';
  END IF;

  IF p_pin_hash IS NULL OR char_length(p_pin_hash) < 50 THEN
    RAISE EXCEPTION 'invalid pin hash'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.security_otps
  SET reset_grant_consumed_at = now()
  WHERE user_id = p_user_id
    AND reset_grant_id = p_grant_id
    AND reset_grant_consumed_at IS NULL
    AND verified = true
  RETURNING id INTO v_otp_id;

  IF v_otp_id IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.users
  SET
    security_pin_hash = p_pin_hash,
    security_pin_updated_at = now(),
    pin_failed_attempts = 0,
    pin_locked_until = NULL
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'user missing for pin reset'
      USING ERRCODE = 'P0002';
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_pin_reset(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_pin_reset(uuid, uuid, text) TO service_role;

GRANT UPDATE ON TABLE public.security_otps TO service_role;

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
    UPDATE public.beneficiary_email_verifications
    SET used_at = now()
    WHERE beneficiary_id = NEW.id
      AND used_at IS NULL;
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
  IF public.request_role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'get_my_beneficiary_relationships is service_role only'
      USING ERRCODE = '42501';
  END IF;

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
