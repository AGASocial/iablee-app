import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createAuthenticatedRouteClient, hasPinResetSession } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { createSecuritySessionToken } from "@/lib/security";
import {
    SECURITY_SESSION_COOKIE_NAME,
    SECURITY_SESSION_MAX_AGE_SECONDS,
    securitySessionCookieOptions,
} from "@/lib/security-cookie";
import bcrypt from "bcryptjs";

export async function POST(req: NextRequest) {
    try {
        const { user } = await createAuthenticatedRouteClient();

        if (!user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await req.json();
        const { pin } = body;

        if (!pin || pin.length !== 6 || !/^\d+$/.test(pin)) {
            return NextResponse.json(
                { error: "PIN must be a 6-digit number" },
                { status: 400 }
            );
        }

        const { data: userData, error: fetchError } = await supabaseAdmin
            .from("users")
            .select("security_pin_hash")
            .eq("id", user.id)
            .single();

        if (fetchError || !userData) {
            console.error("Error fetching user data:", fetchError);
            return NextResponse.json(
                { error: "Failed to set security PIN" },
                { status: 500 }
            );
        }

        const pinAlreadySet = Boolean(userData.security_pin_hash);
        if (pinAlreadySet) {
            const resetSession = await hasPinResetSession(user.id);
            if (!resetSession) {
                return NextResponse.json(
                    { error: "A verified reset code is required to replace an existing PIN" },
                    { status: 403 }
                );
            }
        }

        const salt = await bcrypt.genSalt(10);
        const hash = await bcrypt.hash(pin, salt);

        const { error: updateError } = await supabaseAdmin
            .from("users")
            .update({
                security_pin_hash: hash,
                security_pin_updated_at: new Date().toISOString(),
            })
            .eq("id", user.id);

        if (updateError) {
            console.error("Error updating PIN:", updateError);
            return NextResponse.json(
                { error: "Failed to set security PIN" },
                { status: 500 }
            );
        }

        if (pinAlreadySet) {
            const token = await createSecuritySessionToken(user.id, "pin_verified");
            const cookieStore = await cookies();
            cookieStore.set(
                SECURITY_SESSION_COOKIE_NAME,
                token,
                securitySessionCookieOptions(SECURITY_SESSION_MAX_AGE_SECONDS)
            );
        }

        return NextResponse.json({ success: true });
    } catch (err: unknown) {
        const error = err as Error;
        console.error("Error setting PIN:", error);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}
