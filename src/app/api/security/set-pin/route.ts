import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createAuthenticatedRouteClient, readPinResetGrant } from "@/lib/supabase-server";
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

        const { data: hasPin, error: hasPinError } = await supabaseAdmin.rpc(
            "user_has_security_pin",
            { p_user_id: user.id }
        );

        if (hasPinError || typeof hasPin !== "boolean") {
            console.error("Error reading PIN status:", hasPinError);
            return NextResponse.json(
                { error: "Failed to set security PIN" },
                { status: 500 }
            );
        }

        const salt = await bcrypt.genSalt(10);
        const hash = await bcrypt.hash(pin, salt);

        if (hasPin) {
            const grantId = await readPinResetGrant(user.id);
            if (!grantId) {
                return NextResponse.json(
                    { error: "A verified reset code is required to replace an existing PIN" },
                    { status: 403 }
                );
            }

            const { data: applied, error: applyError } = await supabaseAdmin.rpc(
                "apply_pin_reset",
                {
                    p_user_id: user.id,
                    p_grant_id: grantId,
                    p_pin_hash: hash,
                }
            );

            if (applyError) {
                console.error("Error applying PIN reset:", applyError);
                return NextResponse.json(
                    { error: "Failed to set security PIN" },
                    { status: 500 }
                );
            }

            if (applied !== true) {
                return NextResponse.json(
                    { error: "A verified reset code is required to replace an existing PIN" },
                    { status: 403 }
                );
            }

            const token = await createSecuritySessionToken(user.id, "pin_verified");
            const cookieStore = await cookies();
            cookieStore.set(
                SECURITY_SESSION_COOKIE_NAME,
                token,
                securitySessionCookieOptions(SECURITY_SESSION_MAX_AGE_SECONDS)
            );

            return NextResponse.json({ success: true });
        }

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
