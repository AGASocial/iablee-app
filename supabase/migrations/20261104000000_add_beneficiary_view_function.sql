-- Migration: Add function and policy for users to view who added them as beneficiaries
-- This allows beneficiaries to see the account holders who named them, without exposing asset data

-- Drop existing function if it exists
DROP FUNCTION IF EXISTS public.get_my_beneficiary_relationships();

-- Create a security definer function that returns beneficiary relationships for the current user
-- based on their verified email address
CREATE OR REPLACE FUNCTION public.get_my_beneficiary_relationships()
RETURNS TABLE (
  holder_id uuid,
  holder_full_name text,
  holder_email text,
  relationship_id integer,
  beneficiary_id uuid,
  email_verified boolean,
  email_verified_at timestamp with time zone,
  created_at timestamp with time zone,
  updated_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_email text;
BEGIN
  -- Get the email of the authenticated user
  SELECT email INTO current_user_email 
  FROM auth.users 
  WHERE id = auth.uid();

  -- Return beneficiary relationships where the current user's email matches the beneficiary email
  -- Only return verified beneficiaries for security
  RETURN QUERY
  SELECT 
    b.user_id as holder_id,
    u.full_name as holder_full_name,
    u.email as holder_email,
    b.relationship_id,
    b.id as beneficiary_id,
    b.email_verified,
    b.email_verified_at,
    b.created_at,
    b.updated_at
  FROM public.beneficiaries b
  JOIN public.users u ON u.id = b.user_id
  WHERE b.email = current_user_email
    AND b.email_verified = true
  ORDER BY b.created_at DESC;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.get_my_beneficiary_relationships() TO authenticated;

-- Add comment for documentation
COMMENT ON FUNCTION public.get_my_beneficiary_relationships() IS 
'Returns a list of account holders who have added the authenticated user as a beneficiary. Only includes verified beneficiary relationships. Does not expose asset contents, passwords, or files.';
