import { NextRequest, NextResponse } from "next/server";
import { createAuthenticatedRouteClient } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { createSecuritySessionToken } from "@/lib/security";
import {
    SECURITY_SESSION_COOKIE_NAME,
    SECURITY_SESSION_MAX_AGE_SECONDS,
    securitySessionCookieOptions,
} from "@/lib/security-cookie";
import { takeSecurityPinIpLimit, takeSecurityPinUserLimit } from "@/lib/rate-limit";
import { isPinLocked } from "@/lib/pin-lockout";
import { recordPinFailedAttempt } from "@/lib/pin-failures";

export async function POST(req: NextRequest) {
    try {
        const ipLimit = takeSecurityPinIpLimit(req);
        if (ipLimit) return ipLimit;

        const { user } = await createAuthenticatedRouteClient();

        if (!user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const userLimit = takeSecurityPinUserLimit(user.id);
        if (userLimit) return userLimit;

        const body = await req.json();
        const { pin } = body;

        if (!pin) {
            return NextResponse.json({ error: "PIN is required" }, { status: 400 });
        }

        const { data: userData, error: fetchError } = await supabaseAdmin
            .from("users")
            .select("security_pin_hash, pin_locked_until")
            .eq("id", user.id)
            .single();

        if (fetchError || !userData) {
            console.error("Error fetching user data:", fetchError);
            return NextResponse.json(
                { error: "Failed to verify PIN" },
                { status: 500 }
            );
        }

        if (isPinLocked(userData.pin_locked_until)) {
            return NextResponse.json(
                {
                    success: false,
                    error: "PIN locked due to too many failed attempts",
                    lockedUntil: userData.pin_locked_until,
                },
                { status: 423 }
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
            const failure = await recordPinFailedAttempt(user.id);
            if (!failure) {
                return NextResponse.json(
                    { error: "Failed to verify PIN" },
                    { status: 500 }
                );
            }

            if (failure.locked) {
                return NextResponse.json(
                    {
                        success: false,
                        error: "PIN locked due to too many failed attempts",
                        lockedUntil: failure.lockedUntil,
                    },
                    { status: 423 }
                );
            }

            return NextResponse.json(
                {
                    success: false,
                    error: "Invalid PIN",
                    remainingAttempts: failure.remainingAttempts,
                },
                { status: 401 }
            );
        }

        await supabaseAdmin
            .from("users")
            .update({ pin_failed_attempts: 0, pin_locked_until: null })
            .eq("id", user.id);

        const token = await createSecuritySessionToken(user.id, "pin_verified");

        const cookieStore = await cookies();
        cookieStore.set(
            SECURITY_SESSION_COOKIE_NAME,
            token,
            securitySessionCookieOptions(SECURITY_SESSION_MAX_AGE_SECONDS)
        );

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
