-- Beneficiary email verification support
ALTER TABLE public.beneficiaries
  ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;

CREATE TABLE IF NOT EXISTS public.beneficiary_email_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  beneficiary_id uuid NOT NULL REFERENCES public.beneficiaries(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_beneficiary_email_verifications_token_hash
  ON public.beneficiary_email_verifications(token_hash);

CREATE INDEX IF NOT EXISTS idx_beneficiary_email_verifications_beneficiary_id
  ON public.beneficiary_email_verifications(beneficiary_id);

ALTER TABLE public.beneficiary_email_verifications ENABLE ROW LEVEL SECURITY;
