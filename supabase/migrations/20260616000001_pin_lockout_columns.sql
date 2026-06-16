-- US-B-003: PIN lockout columns on users table
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS pin_failed_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS pin_locked_until timestamptz;
