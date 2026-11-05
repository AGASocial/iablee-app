-- Follow-up to 20261104235900. Does not edit that migration.
--
-- Beneficiary email verification locks the beneficiary row and confirms the
-- token email in the same transaction. A zero-row update rolls the token
-- consume back. The email-change trigger is SECURITY DEFINER so it can mark
-- verification tokens used under RLS.
--
-- PIN and PIN-reset checks reserve an attempt with SELECT FOR UPDATE before
-- the application compares a secret. security_pin_version increments in the
-- same UPDATE that writes a new hash. Open reset grants can be consumed
-- without presenting the grant id.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS security_pin_version integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.users.security_pin_version IS
  'Increments when security_pin_hash changes. Security JWTs must carry the same value.';

-- Authenticated clients keep the previous column grant. This counter is read
-- only by service_role when checking a security session.

CREATE OR REPLACE FUNCTION public.bump_security_pin_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.security_pin_hash IS DISTINCT FROM OLD.security_pin_hash
     AND NEW.security_pin_version IS NOT DISTINCT FROM OLD.security_pin_version THEN
    NEW.security_pin_version := OLD.security_pin_version + 1;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.bump_security_pin_version() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bump_security_pin_version() TO service_role;

DROP TRIGGER IF EXISTS users_bump_security_pin_version ON public.users;
CREATE TRIGGER users_bump_security_pin_version
  BEFORE UPDATE OF security_pin_hash ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.bump_security_pin_version();

-- Reserve one PIN attempt before bcrypt. The row lock makes the increment
-- and the lock check one statement. may_compare is false when the account
-- is already locked or this reservation reaches the cap, so the caller must
-- not compare. A later success resets the counter.
CREATE OR REPLACE FUNCTION public.begin_pin_attempt(p_user_id uuid)
RETURNS TABLE (
  pin_hash text,
  failed_attempts integer,
  locked_until timestamptz,
  already_locked boolean,
  may_compare boolean,
  pin_version integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hash text;
  v_attempts integer;
  v_locked_until timestamptz;
  v_version integer;
  v_next_attempts integer;
  v_next_locked timestamptz;
BEGIN
  IF public.request_role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'begin_pin_attempt is service_role only'
      USING ERRCODE = '42501';
  END IF;

  SELECT u.security_pin_hash, u.pin_failed_attempts, u.pin_locked_until, u.security_pin_version
  INTO v_hash, v_attempts, v_locked_until, v_version
  FROM public.users u
  WHERE u.id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_locked_until IS NOT NULL AND v_locked_until > now() THEN
    RETURN QUERY
    SELECT NULL::text, v_attempts, v_locked_until, true, false, v_version;
    RETURN;
  END IF;

  IF v_hash IS NULL THEN
    RETURN QUERY
    SELECT
      NULL::text,
      CASE
        WHEN v_locked_until IS NOT NULL AND v_locked_until <= now() THEN 0
        ELSE v_attempts
      END,
      NULL::timestamptz,
      false,
      false,
      v_version;
    RETURN;
  END IF;

  v_next_attempts := CASE
    WHEN v_locked_until IS NOT NULL AND v_locked_until <= now() THEN 1
    ELSE v_attempts + 1
  END;

  v_next_locked := CASE
    WHEN v_next_attempts >= 5 THEN now() + interval '15 minutes'
    ELSE NULL
  END;

  UPDATE public.users
  SET
    pin_failed_attempts = v_next_attempts,
    pin_locked_until = v_next_locked
  WHERE id = p_user_id;

  RETURN QUERY
  SELECT
    CASE WHEN v_next_locked IS NULL THEN v_hash ELSE NULL::text END,
    v_next_attempts,
    v_next_locked,
    false,
    v_next_locked IS NULL,
    v_version;
END;
$$;

REVOKE ALL ON FUNCTION public.begin_pin_attempt(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_pin_attempt(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.begin_pin_reset_attempt(p_user_id uuid)
RETURNS TABLE (
  failed_attempts integer,
  locked_until timestamptz,
  already_locked boolean,
  may_compare boolean,
  pin_version integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempts integer;
  v_locked_until timestamptz;
  v_version integer;
  v_next_attempts integer;
  v_next_locked timestamptz;
BEGIN
  IF public.request_role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'begin_pin_reset_attempt is service_role only'
      USING ERRCODE = '42501';
  END IF;

  SELECT u.pin_reset_failed_attempts, u.pin_reset_locked_until, u.security_pin_version
  INTO v_attempts, v_locked_until, v_version
  FROM public.users u
  WHERE u.id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_locked_until IS NOT NULL AND v_locked_until > now() THEN
    RETURN QUERY
    SELECT v_attempts, v_locked_until, true, false, v_version;
    RETURN;
  END IF;

  v_next_attempts := CASE
    WHEN v_locked_until IS NOT NULL AND v_locked_until <= now() THEN 1
    ELSE v_attempts + 1
  END;

  v_next_locked := CASE
    WHEN v_next_attempts >= 5 THEN now() + interval '15 minutes'
    ELSE NULL
  END;

  UPDATE public.users
  SET
    pin_reset_failed_attempts = v_next_attempts,
    pin_reset_locked_until = v_next_locked
  WHERE id = p_user_id;

  RETURN QUERY
  SELECT
    v_next_attempts,
    v_next_locked,
    false,
    v_next_locked IS NULL,
    v_version;
END;
$$;

REVOKE ALL ON FUNCTION public.begin_pin_reset_attempt(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_pin_reset_attempt(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.consume_open_pin_reset_grants(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.request_role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'consume_open_pin_reset_grants is service_role only'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.security_otps
  SET reset_grant_consumed_at = now()
  WHERE user_id = p_user_id
    AND reset_grant_id IS NOT NULL
    AND reset_grant_consumed_at IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_open_pin_reset_grants(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_open_pin_reset_grants(uuid) TO service_role;

-- Return type changes from boolean to the new PIN version, so replace the function.
DROP FUNCTION IF EXISTS public.apply_pin_reset(uuid, uuid, text);

CREATE FUNCTION public.apply_pin_reset(
  p_user_id uuid,
  p_grant_id uuid,
  p_pin_hash text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_otp_id uuid;
  v_version integer;
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
    RETURN NULL;
  END IF;

  UPDATE public.users
  SET
    security_pin_hash = p_pin_hash,
    security_pin_updated_at = now(),
    security_pin_version = security_pin_version + 1,
    pin_failed_attempts = 0,
    pin_locked_until = NULL
  WHERE id = p_user_id
  RETURNING security_pin_version INTO v_version;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'user missing for pin reset'
      USING ERRCODE = 'P0002';
  END IF;

  RETURN v_version;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_pin_reset(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_pin_reset(uuid, uuid, text) TO service_role;

-- Lock the beneficiary, require the token email, and roll back the token
-- consume when that update matches nothing.
CREATE OR REPLACE FUNCTION public.verify_beneficiary_email(p_token_hash text)
RETURNS TABLE (
  status text,
  beneficiary_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_beneficiary_id uuid;
  v_expires timestamptz;
  v_used timestamptz;
  v_email text;
  v_name text;
  v_updated integer;
  v_result text := 'invalid';
BEGIN
  IF public.request_role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'verify_beneficiary_email is service_role only'
      USING ERRCODE = '42501';
  END IF;

  IF p_token_hash IS NULL OR length(trim(p_token_hash)) = 0 THEN
    status := 'invalid';
    beneficiary_name := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT v.id, v.beneficiary_id, v.expires_at, v.used_at, v.email
  INTO v_id, v_beneficiary_id, v_expires, v_used, v_email
  FROM public.beneficiary_email_verifications v
  WHERE v.token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    status := 'invalid';
    beneficiary_name := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_used IS NOT NULL THEN
    status := 'used';
    beneficiary_name := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_expires < now() THEN
    status := 'expired';
    beneficiary_name := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_email IS NULL OR length(btrim(v_email)) = 0 THEN
    status := 'invalid';
    beneficiary_name := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT b.full_name
  INTO v_name
  FROM public.beneficiaries b
  WHERE b.id = v_beneficiary_id
  FOR UPDATE;

  IF NOT FOUND THEN
    status := 'invalid';
    beneficiary_name := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  BEGIN
    UPDATE public.beneficiary_email_verifications
    SET used_at = now()
    WHERE id = v_id
      AND used_at IS NULL;

    IF NOT FOUND THEN
      v_result := 'used';
    ELSE
      UPDATE public.beneficiaries
      SET
        email_verified = true,
        email_verified_at = now()
      WHERE id = v_beneficiary_id
        AND lower(btrim(email)) = lower(btrim(v_email));

      GET DIAGNOSTICS v_updated = ROW_COUNT;

      IF v_updated = 0 THEN
        RAISE EXCEPTION 'beneficiary email no longer matches verification token'
          USING ERRCODE = 'P0001';
      END IF;

      v_result := 'success';
    END IF;
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      -- Rolls back the token consume in this subtransaction.
      v_result := 'invalid';
  END;

  IF v_result = 'success' THEN
    status := 'success';
    beneficiary_name := coalesce(v_name, 'Beneficiary');
  ELSIF v_result = 'used' THEN
    status := 'used';
    beneficiary_name := NULL;
  ELSE
    status := 'invalid';
    beneficiary_name := NULL;
  END IF;

  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.verify_beneficiary_email(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_beneficiary_email(text) TO service_role;

-- SECURITY DEFINER lets the email-change trigger update verification tokens
-- even though that table has RLS and no policies for authenticated users.
CREATE OR REPLACE FUNCTION public.protect_beneficiary_email_verified()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
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

ALTER FUNCTION public.protect_beneficiary_email_verified() SECURITY DEFINER;
ALTER FUNCTION public.protect_beneficiary_email_verified() SET search_path = public;

REVOKE ALL ON FUNCTION public.protect_beneficiary_email_verified() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.protect_beneficiary_email_verified() TO anon, authenticated, service_role;

-- lower(email) does not match the lower(btrim(email)) lookup.
DROP INDEX IF EXISTS public.beneficiaries_lower_email_verified_idx;
