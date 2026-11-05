import { NextRequest, NextResponse } from "next/server";
import { createAuthenticatedRouteClient } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import bcrypt from "bcryptjs";
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
        const { currentPin, newPin } = body;

        if (!newPin || newPin.length !== 6 || !/^\d+$/.test(newPin)) {
            return NextResponse.json(
                { error: "New PIN must be a 6-digit number" },
                { status: 400 }
            );
        }

        const { data: userData, error: fetchError } = await supabaseAdmin
            .from("users")
            .select("security_pin_hash, pin_locked_until")
            .eq("id", user.id)
            .single();

        if (fetchError || !userData) {
            console.error("Error fetching user data:", fetchError);
            return NextResponse.json(
                { error: "Failed to verify current PIN" },
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

        if (userData.security_pin_hash) {
            if (!currentPin) {
                return NextResponse.json(
                    { error: "Current PIN is required" },
                    { status: 400 }
                );
            }
            const isValid = await bcrypt.compare(currentPin, userData.security_pin_hash);
            if (!isValid) {
                const failure = await recordPinFailedAttempt(user.id);
                if (!failure) {
                    return NextResponse.json(
                        { error: "Failed to verify current PIN" },
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
                        error: "Incorrect current PIN",
                        remainingAttempts: failure.remainingAttempts,
                    },
                    { status: 401 }
                );
            }
        }

        const salt = await bcrypt.genSalt(10);
        const hash = await bcrypt.hash(newPin, salt);

        const { error: updateError } = await supabaseAdmin
            .from("users")
            .update({
                security_pin_hash: hash,
                security_pin_updated_at: new Date().toISOString(),
                pin_failed_attempts: 0,
                pin_locked_until: null,
            })
            .eq("id", user.id);

        if (updateError) {
            console.error("Error updating PIN:", updateError);
            return NextResponse.json(
                { error: "Failed to update security PIN" },
                { status: 500 }
            );
        }

        return NextResponse.json({ success: true });

    } catch (err: unknown) {
        const error = err as Error;
        console.error("Error changing PIN:", error);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}
