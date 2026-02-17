import { NextResponse } from "next/server";
import { createAuthenticatedRouteClient } from "@/lib/supabase-server";
import { cookies } from "next/headers";
import { verifySecuritySessionToken } from "@/lib/security";

export async function GET() {
    try {
        const { supabase, user } = await createAuthenticatedRouteClient();

        if (!user) {
            return NextResponse.json({ authenticated: false, locked: true, hasPin: false }, { status: 200 });
        }

        // Check if PIN is set
        const { data: userData, error: fetchError } = await supabase
            .from("users")
            .select("security_pin_hash")
            .eq("id", user.id)
            .single();

        if (fetchError) {
            console.error("Error fetching user pin status:", fetchError);
            return NextResponse.json({ error: "Failed to check status" }, { status: 500 });
        }

        const hasPin = !!userData?.security_pin_hash;

        const cookieStore = await cookies();
        const securitySession = cookieStore.get("security_session");
        const isSessionValid = securitySession?.value ? await verifySecuritySessionToken(securitySession.value) : false;

        // Locked if: Has PIN AND Session Invalid.
        // If Has PIN is false, we technically aren't "locked" efficiently, but we need to trigger "setup".
        // For UI simplicity: Return hasPin. 
        // If hasPin is true, locked = !isSessionValid.
        // If hasPin is false, locked = true (strictly speaking, we want to force setup).

        return NextResponse.json({
            authenticated: true,
            hasPin,
            locked: hasPin ? !isSessionValid : true, // If no PIN, treat as locked to force setup
        });

    } catch (err: unknown) {
        const error = err as Error;
        console.error("Error checking session:", error);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}
