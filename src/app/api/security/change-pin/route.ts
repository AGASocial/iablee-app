import { NextRequest, NextResponse } from "next/server";
import { createAuthenticatedRouteClient } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import bcrypt from "bcryptjs";
import { takeSecurityPinIpLimit, takeSecurityPinUserLimit } from "@/lib/rate-limit";
import { beginPinAttempt, finishFailedPinCompare, pinAttemptBlocksCompare } from "@/lib/pin-failures";
import { assignInitialSecurityPin, replaceSecurityPin } from "@/lib/security-pin-write";

const RESET_REQUIRED = "A verified reset code is required to replace an existing PIN";

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

        if (!currentPin) {
            const { data: hasPin, error: hasPinError } = await supabaseAdmin.rpc(
                "user_has_security_pin",
                { p_user_id: user.id }
            );
            if (hasPinError || typeof hasPin !== "boolean") {
                console.error("Error reading PIN status:", hasPinError);
                return NextResponse.json(
                    { error: "Failed to update security PIN" },
                    { status: 500 }
                );
            }
            if (hasPin) {
                return NextResponse.json(
                    { error: "Current PIN is required" },
                    { status: 400 }
                );
            }

            const salt = await bcrypt.genSalt(10);
            const hash = await bcrypt.hash(newPin, salt);
            const written = await assignInitialSecurityPin(user.id, hash);
            if (written === "error") {
                return NextResponse.json(
                    { error: "Failed to update security PIN" },
                    { status: 500 }
                );
            }
            if (written === "conflict") {
                return NextResponse.json({ error: RESET_REQUIRED }, { status: 409 });
            }
            return NextResponse.json({ success: true });
        }

        const claim = await beginPinAttempt(user.id);
        if (!claim) {
            return NextResponse.json(
                { error: "Failed to verify current PIN" },
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

        const salt = await bcrypt.genSalt(10);
        const hash = await bcrypt.hash(newPin, salt);

        if (!claim.mayCompare || !claim.pinHash) {
            const written = await assignInitialSecurityPin(user.id, hash);
            if (written === "error") {
                return NextResponse.json(
                    { error: "Failed to update security PIN" },
                    { status: 500 }
                );
            }
            if (written === "conflict") {
                return NextResponse.json({ error: RESET_REQUIRED }, { status: 409 });
            }
            return NextResponse.json({ success: true });
        }

        const isValid = await bcrypt.compare(currentPin, claim.pinHash);
        if (!isValid) {
            const outcome = await finishFailedPinCompare(user.id, claim.attempts, 'pin');
            if (outcome.action === 'error') {
                return NextResponse.json(
                    { error: "Failed to verify current PIN" },
                    { status: 500 }
                );
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
                    error: "Incorrect current PIN",
                    remainingAttempts: outcome.remainingAttempts,
                },
                { status: 401 }
            );
        }

        const replaced = await replaceSecurityPin(user.id, claim.pinHash, hash);
        if (replaced === "error") {
            return NextResponse.json(
                { error: "Failed to update security PIN" },
                { status: 500 }
            );
        }
        if (replaced === "conflict") {
            return NextResponse.json({ error: RESET_REQUIRED }, { status: 409 });
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
