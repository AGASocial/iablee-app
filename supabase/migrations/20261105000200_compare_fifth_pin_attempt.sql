-- Follow-up to 20261105000100. Does not edit that migration.
--
-- The attempt that reaches 5 must still be compared. begin_* no longer sets
-- the 15-minute lock while reserving that attempt. The caller locks after a
-- failed compare. A later call that finds the counter already at the cap
-- locks without another compare, so a missed lock cannot open a sixth try.

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

  IF v_locked_until IS NOT NULL AND v_locked_until <= now() THEN
    v_attempts := 0;
  END IF;

  -- Cap already consumed. Do not compare again; persist the lock if the
  -- failed compare did not.
  IF v_attempts >= 5 THEN
    v_next_locked := now() + interval '15 minutes';
    UPDATE public.users
    SET pin_locked_until = v_next_locked
    WHERE id = p_user_id;

    RETURN QUERY
    SELECT NULL::text, v_attempts, v_next_locked, false, false, v_version;
    RETURN;
  END IF;

  v_next_attempts := v_attempts + 1;

  UPDATE public.users
  SET
    pin_failed_attempts = v_next_attempts,
    pin_locked_until = NULL
  WHERE id = p_user_id;

  RETURN QUERY
  SELECT v_hash, v_next_attempts, NULL::timestamptz, false, true, v_version;
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

  IF v_locked_until IS NOT NULL AND v_locked_until <= now() THEN
    v_attempts := 0;
  END IF;

  IF v_attempts >= 5 THEN
    v_next_locked := now() + interval '15 minutes';
    UPDATE public.users
    SET pin_reset_locked_until = v_next_locked
    WHERE id = p_user_id;

    RETURN QUERY
    SELECT v_attempts, v_next_locked, false, false, v_version;
    RETURN;
  END IF;

  v_next_attempts := v_attempts + 1;

  UPDATE public.users
  SET
    pin_reset_failed_attempts = v_next_attempts,
    pin_reset_locked_until = NULL
  WHERE id = p_user_id;

  RETURN QUERY
  SELECT v_next_attempts, NULL::timestamptz, false, true, v_version;
END;
$$;

REVOKE ALL ON FUNCTION public.begin_pin_reset_attempt(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_pin_reset_attempt(uuid) TO service_role;
