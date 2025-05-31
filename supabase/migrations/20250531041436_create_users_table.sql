   create table public.users (
     id uuid primary key default uuid_generate_v4(),
     email text not null unique,
     full_name text,
     created_at timestamp with time zone default timezone('utc'::text, now()),
     updated_at timestamp with time zone default timezone('utc'::text, now())
   );

   -- Enable RLS
   ALTER TABLE users ENABLE ROW LEVEL SECURITY;

   -- Allow inserts for anon users (for testing)
   CREATE POLICY "Allow anon insert" ON users
     FOR INSERT
     USING (true);