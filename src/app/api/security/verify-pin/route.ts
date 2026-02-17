import { NextRequest, NextResponse } from "next/server";
import { createAuthenticatedRouteClient } from "@/lib/supabase-server";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { createSecuritySessionToken } from "@/lib/security";

export async function POST(req: NextRequest) {
    try {
        const { supabase, user } = await createAuthenticatedRouteClient();

        if (!user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await req.json();
        const { pin } = body;

        if (!pin) {
            return NextResponse.json({ error: "PIN is required" }, { status: 400 });
        }

        // Fetch the user's PIN hash
        const { data: userData, error: fetchError } = await supabase
            .from("users")
            .select("security_pin_hash")
            .eq("id", user.id)
            .single();

        if (fetchError || !userData) {
            console.error("Error fetching user data:", fetchError);
            return NextResponse.json(
                { error: "Failed to verify PIN" },
                { status: 500 }
            );
        }

        if (!userData.security_pin_hash) {
            return NextResponse.json(
                { error: "Security PIN not set" },
                { status: 400 }
            );
        }

        const isValid = await bcrypt.compare(pin, userData.security_pin_hash);

        if (!isValid) {
            return NextResponse.json({ success: false, error: "Invalid PIN" }, { status: 401 });
        }

        // Generate signed token
        const token = await createSecuritySessionToken(user.id);

        // specific name for the security cookie
        const cookieStore = await cookies();
        // Set a short-lived session cookie for the security PIN access
        // 15 minutes expiration
        const expiry = new Date(Date.now() + 15 * 60 * 1000);

        cookieStore.set("security_session", token, {
            expires: expiry,
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            path: "/",
            sameSite: "lax",
        });

        return NextResponse.json({ success: true });
    } catch (err: unknown) {
        const error = err as Error;
        console.error("Error verifying PIN:", error);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}
