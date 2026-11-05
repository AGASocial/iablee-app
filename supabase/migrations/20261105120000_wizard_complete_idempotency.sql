-- Transactional and idempotent wizard completion.
-- Creates one asset + beneficiary + assignment + attachments atomically.
-- Reuses the previous response when the same idempotency key is used by the same user.

CREATE TABLE IF NOT EXISTS public.wizard_completion_idempotency (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  response jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key)
);

ALTER TABLE public.wizard_completion_idempotency ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.complete_wizard_transaction(
  p_user_id uuid,
  p_idempotency_key text,
  p_asset jsonb,
  p_beneficiary jsonb,
  p_file_urls jsonb DEFAULT '[]'::jsonb,
  p_file_metadata jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted integer;
  v_saved_response jsonb;
  v_asset_row public.digital_assets%ROWTYPE;
  v_beneficiary_row public.beneficiaries%ROWTYPE;
  v_result jsonb;
  v_email text;
BEGIN
  IF public.request_role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'complete_wizard_transaction is service_role only'
      USING ERRCODE = '42501';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user id is required' USING ERRCODE = '22023';
  END IF;

  IF p_idempotency_key IS NULL OR length(btrim(p_idempotency_key)) = 0 THEN
    RAISE EXCEPTION 'idempotency key is required' USING ERRCODE = '22023';
  END IF;

  IF coalesce(p_asset->>'assetType', '') = '' OR coalesce(p_asset->>'assetName', '') = '' THEN
    RAISE EXCEPTION 'assetType and assetName are required' USING ERRCODE = '22023';
  END IF;

  IF coalesce(p_beneficiary->>'fullName', '') = '' THEN
    RAISE EXCEPTION 'beneficiary fullName is required' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.wizard_completion_idempotency (user_id, idempotency_key, response)
  VALUES (p_user_id, btrim(p_idempotency_key), NULL)
  ON CONFLICT (user_id, idempotency_key) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  BEGIN
    SELECT response
    INTO v_saved_response
    FROM public.wizard_completion_idempotency
    WHERE user_id = p_user_id
      AND idempotency_key = btrim(p_idempotency_key)
    FOR UPDATE NOWAIT;
  EXCEPTION
    WHEN lock_not_available THEN
      RAISE EXCEPTION 'idempotency key is currently being processed'
        USING ERRCODE = '55P03';
  END;

  IF v_inserted = 0 THEN
    IF v_saved_response IS NULL THEN
      RAISE EXCEPTION 'idempotency key is currently being processed'
        USING ERRCODE = '55P03';
    END IF;
    RETURN jsonb_build_object(
      'idempotent', true,
      'result', v_saved_response
    );
  END IF;

  v_email := nullif(lower(btrim(coalesce(p_beneficiary->>'email', ''))), '');

  INSERT INTO public.digital_assets (
    user_id,
    asset_type,
    asset_name,
    description,
    website,
    valid_until,
    email,
    password,
    files,
    custom_fields,
    status
  )
  VALUES (
    p_user_id,
    p_asset->>'assetType',
    p_asset->>'assetName',
    nullif(p_asset->>'description', ''),
    nullif(p_asset->>'website', ''),
    CASE
      WHEN nullif(p_asset->>'validUntil', '') IS NULL THEN NULL
      ELSE (p_asset->>'validUntil')::date
    END,
    nullif(p_asset->>'email', ''),
    nullif(p_asset->>'password', ''),
    CASE
      WHEN jsonb_typeof(p_file_urls) = 'array' AND jsonb_array_length(p_file_urls) > 0 THEN p_file_urls
      ELSE NULL
    END,
    CASE
      WHEN jsonb_typeof(p_asset->'customFields') = 'object' THEN p_asset->'customFields'
      ELSE NULL
    END,
    'unassigned'
  )
  RETURNING * INTO v_asset_row;

  INSERT INTO public.beneficiaries (
    user_id,
    full_name,
    email,
    relationship_id,
    phone_number,
    notes,
    notified,
    email_verified,
    email_verified_at,
    status
  )
  VALUES (
    p_user_id,
    p_beneficiary->>'fullName',
    v_email,
    CASE
      WHEN nullif(p_beneficiary->>'relationshipId', '') IS NULL THEN NULL
      ELSE (p_beneficiary->>'relationshipId')::integer
    END,
    nullif(p_beneficiary->>'phoneNumber', ''),
    nullif(p_beneficiary->>'notes', ''),
    false,
    false,
    NULL,
    'active'
  )
  RETURNING * INTO v_beneficiary_row;

  UPDATE public.digital_assets
  SET
    beneficiary_id = v_beneficiary_row.id,
    status = 'assigned'
  WHERE id = v_asset_row.id
    AND user_id = p_user_id
  RETURNING * INTO v_asset_row;

  IF jsonb_typeof(p_file_metadata) = 'array' AND jsonb_array_length(p_file_metadata) > 0 THEN
    INSERT INTO public.asset_attachments (
      asset_id,
      file_path,
      file_name,
      file_type,
      file_size
    )
    SELECT
      v_asset_row.id,
      item->>'path',
      item->>'fileName',
      coalesce(nullif(item->>'fileType', ''), 'other'),
      coalesce((item->>'fileSize')::bigint, 0)
    FROM jsonb_array_elements(p_file_metadata) item
    WHERE coalesce(item->>'path', '') <> ''
      AND coalesce(item->>'fileName', '') <> '';
  END IF;

  v_result := jsonb_build_object(
    'asset', to_jsonb(v_asset_row),
    'beneficiary', to_jsonb(v_beneficiary_row)
  );

  UPDATE public.wizard_completion_idempotency
  SET response = v_result
  WHERE user_id = p_user_id
    AND idempotency_key = btrim(p_idempotency_key);

  RETURN jsonb_build_object(
    'idempotent', false,
    'result', v_result
  );
END;
$$;

ALTER FUNCTION public.complete_wizard_transaction(uuid, text, jsonb, jsonb, jsonb, jsonb) OWNER TO postgres;

REVOKE ALL ON TABLE public.wizard_completion_idempotency FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_wizard_transaction(uuid, text, jsonb, jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_wizard_transaction(uuid, text, jsonb, jsonb, jsonb, jsonb) TO service_role;
