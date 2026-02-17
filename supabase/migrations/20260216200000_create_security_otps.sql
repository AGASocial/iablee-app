create table security_otps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  code text not null,
  expires_at timestamptz not null,
  created_at timestamptz default now(),
  verified boolean default false
);
