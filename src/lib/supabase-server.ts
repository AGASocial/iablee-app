import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { Database } from '@/lib/supabase';

/**
 * Creates an authenticated Supabase server client for use in API routes.
 * Eliminates the repeated boilerplate of setting up cookie handling.
 */
export async function createRouteClient() {
    const cookieStore = await cookies();

    return createServerClient<Database>(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll() {
                    return cookieStore.getAll();
                },
                setAll(cookiesToSet) {
                    try {
                        cookiesToSet.forEach(({ name, value, options }) =>
                            cookieStore.set(name, value, options)
                        );
                    } catch {
                        // The `setAll` method was called from a Server Component.
                        // This can be ignored if you have middleware refreshing
                        // user sessions.
                    }
                },
            },
        }
    );
}

/**
 * Creates an authenticated Supabase server client and validates the user.
 * Returns { supabase, user } or throws if not authenticated.
 * Use this when you need to guarantee the user is authenticated.
 */
export async function createAuthenticatedRouteClient() {
    const supabase = await createRouteClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return { supabase, user: null } as const;
    }

    return { supabase, user } as const;
}
