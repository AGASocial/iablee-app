import { NextRequest, NextResponse } from "next/server";
import { createAuthenticatedRouteClient } from "@/lib/supabase-server";

export async function GET() {
    try {
        const { supabase, user } = await createAuthenticatedRouteClient();

        if (!user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        // Fetch additional profile data from public.users table (if needed)
        // Since user metadata might not be fully synced or we want `full_name` from DB
        const { data: userData, error } = await supabase
            .from('users')
            .select('full_name')
            .eq('id', user.id)
            .single();

        if (error && error.code !== 'PGRST116') { // Ignore "no rows returned" if handled by fallback
            console.error("Error fetching user profile:", error);
            // Non-critical, can fallback to auth user metadata
        }

        const profile = {
            id: user.id,
            email: user.email,
            full_name: userData?.full_name || user.user_metadata?.full_name || '',
            identities: user.identities,
            user_metadata: user.user_metadata,
        };

        return NextResponse.json(profile);
    } catch (err: unknown) {
        const error = err as Error;
        console.error("Error fetching profile:", error);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}

export async function PUT(req: NextRequest) {
    try {
        const { supabase, user } = await createAuthenticatedRouteClient();

        if (!user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await req.json();
        const { fullName } = body;

        if (!fullName || typeof fullName !== 'string') {
            return NextResponse.json({ error: "Full Name is required" }, { status: 400 });
        }

        // 1. Update auth.users metadata
        const { error: authError } = await supabase.auth.updateUser({
            data: { full_name: fullName }
        });

        if (authError) {
            console.error("Error updating auth metadata:", authError);
            return NextResponse.json({ error: "Failed to update profile metadata" }, { status: 500 });
        }

        // 2. Update public.users table
        const { error: dbError } = await supabase
            .from('users')
            .update({ full_name: fullName })
            .eq('id', user.id);

        if (dbError) {
            console.error("Error updating public profile:", dbError);
            return NextResponse.json({ error: "Failed to update public profile" }, { status: 500 });
        }

        return NextResponse.json({ success: true });

    } catch (err: unknown) {
        const error = err as Error;
        console.error("Error updating profile:", error);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}
