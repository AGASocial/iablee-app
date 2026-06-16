import { NextRequest, NextResponse } from "next/server";
import { createAuthenticatedRouteClient } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { createSecuritySessionToken } from "@/lib/security";
import { checkRateLimit, getClientIp, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import {
    isPinLocked,
    nextLockoutExpiry,
    PIN_LOCKOUT_MAX_ATTEMPTS,
} from "@/lib/pin-lockout";

export async function POST(req: NextRequest) {
    try {
        const ip = getClientIp(req);
        const rateLimit = checkRateLimit(`security:verify-pin:${ip}`, RATE_LIMITS.securityPin);
        if (!rateLimit.allowed) {
            return rateLimitResponse(rateLimit.resetAt);
        }

        const { user } = await createAuthenticatedRouteClient();

        if (!user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const userRateLimit = checkRateLimit(
            `security:verify-pin:user:${user.id}`,
            RATE_LIMITS.securityPin
        );
        if (!userRateLimit.allowed) {
            return rateLimitResponse(userRateLimit.resetAt);
        }

        const body = await req.json();
        const { pin } = body;

        if (!pin) {
            return NextResponse.json({ error: "PIN is required" }, { status: 400 });
        }

        const { data: userData, error: fetchError } = await supabaseAdmin
            .from("users")
            .select("security_pin_hash, pin_failed_attempts, pin_locked_until")
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
            const attempts = (userData.pin_failed_attempts ?? 0) + 1;
            const updatePayload: {
                pin_failed_attempts: number;
                pin_locked_until?: string;
            } = { pin_failed_attempts: attempts };

            if (attempts >= PIN_LOCKOUT_MAX_ATTEMPTS) {
                updatePayload.pin_locked_until = nextLockoutExpiry();
            }

            await supabaseAdmin
                .from("users")
                .update(updatePayload)
                .eq("id", user.id);

            if (attempts >= PIN_LOCKOUT_MAX_ATTEMPTS) {
                return NextResponse.json(
                    {
                        success: false,
                        error: "PIN locked due to too many failed attempts",
                        lockedUntil: updatePayload.pin_locked_until,
                    },
                    { status: 423 }
                );
            }

            return NextResponse.json(
                {
                    success: false,
                    error: "Invalid PIN",
                    remainingAttempts: PIN_LOCKOUT_MAX_ATTEMPTS - attempts,
                },
                { status: 401 }
            );
        }

        await supabaseAdmin
            .from("users")
            .update({ pin_failed_attempts: 0, pin_locked_until: null })
            .eq("id", user.id);

        const token = await createSecuritySessionToken(user.id);

        const cookieStore = await cookies();
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
