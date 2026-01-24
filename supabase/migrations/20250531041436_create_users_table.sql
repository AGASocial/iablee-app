   create table public.users (
     id uuid primary key default uuid_generate_v4(),
     email text not null unique,
     full_name text,
     created_at timestamp with time zone default timezone('utc'::text, now()),
     updated_at timestamp with time zone default timezone('utc'::text, now())
   );

   -- Enable RLS
   ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

   -- Allow users to insert their own profile
   CREATE POLICY "Allow individual user inserts" ON public.users
     FOR INSERT
     WITH CHECK (auth.uid() = id);

   -- Allow users to read their own profile
   CREATE POLICY "Allow individual user access" ON public.users
     FOR SELECT
     USING (auth.uid() = id);