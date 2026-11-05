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
import { beginPinAttempt, finishFailedPinCompare, pinAttemptBlocksCompare } from "@/lib/pin-failures";

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

        const claim = await beginPinAttempt(user.id);
        if (!claim) {
            return NextResponse.json(
                { error: "Failed to verify PIN" },
                { status: 500 }
            );
        }

        if (pinAttemptBlocksCompare(claim)) {
            return NextResponse.json(
                {
                    success: false,
                    error: "PIN locked due to too many failed attempts",
                    lockedUntil: claim.lockedUntil,
                },
                { status: 423 }
            );
        }

        if (!claim.mayCompare || !claim.pinHash) {
            return NextResponse.json(
                { error: "Security PIN not set" },
                { status: 400 }
            );
        }

        const isValid = await bcrypt.compare(pin, claim.pinHash);

        if (!isValid) {
            const outcome = await finishFailedPinCompare(user.id, claim.attempts, 'pin');
            if (outcome.action === 'error') {
                return NextResponse.json({ error: "Failed to verify PIN" }, { status: 500 });
            }
            if (outcome.action === 'locked') {
                return NextResponse.json(
                    {
                        success: false,
                        error: "PIN locked due to too many failed attempts",
                        lockedUntil: outcome.lockedUntil,
                        remainingAttempts: 0,
                    },
                    { status: 423 }
                );
            }
            return NextResponse.json(
                {
                    success: false,
                    error: "Invalid PIN",
                    remainingAttempts: outcome.remainingAttempts,
                },
                { status: 401 }
            );
        }

        const { error: clearError } = await supabaseAdmin
            .from("users")
            .update({ pin_failed_attempts: 0, pin_locked_until: null })
            .eq("id", user.id);

        if (clearError) {
            console.error("Error clearing PIN lockout:", clearError);
        }

        const token = await createSecuritySessionToken(user.id, "pin_verified", {
            pinVersion: claim.pinVersion,
        });

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
