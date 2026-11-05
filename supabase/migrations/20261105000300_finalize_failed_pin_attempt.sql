-- Follow-up to 20261105000200. Does not edit that migration.
--
-- begin_* reserves the attempt that reaches 5 and still allows that compare.
-- This function applies the 15-minute lock in the same database transaction
-- after that compare fails. A parallel success that already cleared the
-- counter does not lock. Callers must not rely on a later application UPDATE.

CREATE OR REPLACE FUNCTION public.finalize_failed_pin_attempt(
  p_user_id uuid,
  p_scope text,
  p_compare_failed boolean
)
RETURNS TABLE (
  locked boolean,
  locked_until timestamptz,
  failed_attempts integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempts integer;
  v_locked_until timestamptz;
  v_next_locked timestamptz;
BEGIN
  IF public.request_role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'finalize_failed_pin_attempt is service_role only'
      USING ERRCODE = '42501';
  END IF;

  IF p_compare_failed IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'finalize_failed_pin_attempt requires a failed compare'
      USING ERRCODE = '22023';
  END IF;

  IF p_scope = 'pin' THEN
    SELECT u.pin_failed_attempts, u.pin_locked_until
    INTO v_attempts, v_locked_until
    FROM public.users u
    WHERE u.id = p_user_id
    FOR UPDATE;
  ELSIF p_scope = 'reset' THEN
    SELECT u.pin_reset_failed_attempts, u.pin_reset_locked_until
    INTO v_attempts, v_locked_until
    FROM public.users u
    WHERE u.id = p_user_id
    FOR UPDATE;
  ELSE
    RAISE EXCEPTION 'finalize_failed_pin_attempt scope must be pin or reset'
      USING ERRCODE = '22023';
  END IF;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_attempts >= 5 THEN
    v_next_locked := now() + interval '15 minutes';
    IF p_scope = 'pin' THEN
      UPDATE public.users
      SET pin_locked_until = v_next_locked
      WHERE id = p_user_id;
    ELSE
      UPDATE public.users
      SET pin_reset_locked_until = v_next_locked
      WHERE id = p_user_id;
    END IF;

    RETURN QUERY SELECT true, v_next_locked, v_attempts;
    RETURN;
  END IF;

  RETURN QUERY SELECT false, NULL::timestamptz, v_attempts;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_failed_pin_attempt(uuid, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_failed_pin_attempt(uuid, text, boolean) TO service_role;
