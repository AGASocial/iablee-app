-- Migration: Service-role-only function for beneficiaries to view who named them
-- Callable only via the API with the admin client after auth + PIN checks.
-- Does not expose asset data, passwords, or files.

-- Drop prior signatures (parameterless and parameterized)
DROP FUNCTION IF EXISTS public.get_my_beneficiary_relationships();
DROP FUNCTION IF EXISTS public.get_my_beneficiary_relationships(text);

-- Case-insensitive lookup for verified beneficiary emails
CREATE INDEX IF NOT EXISTS beneficiaries_lower_email_verified_idx
  ON public.beneficiaries (lower(email))
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
  WHERE lower(b.email) = lower(trim(p_email))
    AND b.email_verified = true
  ORDER BY b.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_beneficiary_relationships(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_beneficiary_relationships(text) FROM anon;
REVOKE ALL ON FUNCTION public.get_my_beneficiary_relationships(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_beneficiary_relationships(text) TO service_role;

COMMENT ON FUNCTION public.get_my_beneficiary_relationships(text) IS
'Returns account holders who added the given verified email as a beneficiary. Service-role only; API must pass the session user email after auth + PIN. Does not expose assets, passwords, files, or holder identity beyond full name.';
