import { NextRequest, NextResponse } from "next/server";
import { createAuthenticatedRouteClient } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { createSecuritySessionToken } from "@/lib/security";
import { hashPinResetCode } from "@/lib/pin-reset-otp";
import { checkRateLimit, getClientIp, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import {
    isPinLocked,
    nextLockoutExpiry,
    PIN_LOCKOUT_MAX_ATTEMPTS,
} from "@/lib/pin-lockout";
import {
    SECURITY_SESSION_COOKIE_NAME,
    SECURITY_SESSION_MAX_AGE_SECONDS,
    securitySessionCookieOptions,
} from "@/lib/security-cookie";

async function invalidateResetCodes(userId: string) {
    await supabaseAdmin
        .from('security_otps')
        .update({ verified: true, expires_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('verified', false);
}

export async function POST(req: NextRequest) {
    try {
        const ip = getClientIp(req);
        const rateLimit = checkRateLimit(`security:verify-reset-code:${ip}`, RATE_LIMITS.securityPin);
        if (!rateLimit.allowed) {
            return rateLimitResponse(rateLimit.resetAt);
        }

        const { code } = await req.json();
        const { user } = await createAuthenticatedRouteClient();

        if (!user || !user.id) {
            return NextResponse.json({ error: "User not authenticated" }, { status: 401 });
        }

        const userRateLimit = checkRateLimit(
            `security:verify-reset-code:user:${user.id}`,
            RATE_LIMITS.securityPin
        );
        if (!userRateLimit.allowed) {
            return rateLimitResponse(userRateLimit.resetAt);
        }

        const { data: userData, error: userError } = await supabaseAdmin
            .from('users')
            .select('pin_reset_failed_attempts, pin_reset_locked_until')
            .eq('id', user.id)
            .single();

        if (userError || !userData) {
            console.error("Error fetching PIN reset lockout:", userError);
            return NextResponse.json({ error: "Internal server error" }, { status: 500 });
        }

        if (isPinLocked(userData.pin_reset_locked_until)) {
            return NextResponse.json(
                {
                    error: "PIN reset locked due to too many failed attempts",
                    lockedUntil: userData.pin_reset_locked_until,
                },
                { status: 423 }
            );
        }

        const normalizedCode = String(code ?? '').trim();
        const lockExpired = Boolean(
            userData.pin_reset_locked_until && !isPinLocked(userData.pin_reset_locked_until)
        );
        const baseAttempts = lockExpired ? 0 : (userData.pin_reset_failed_attempts ?? 0);

        const codeHash = /^\d{6}$/.test(normalizedCode) ? hashPinResetCode(normalizedCode) : null;
        const { data: otp, error } = codeHash
            ? await supabaseAdmin
                .from('security_otps')
                .select('id')
                .eq('user_id', user.id)
                .eq('code', codeHash)
                .eq('verified', false)
                .gt('expires_at', new Date().toISOString())
                .maybeSingle()
            : { data: null, error: null };

        if (error) {
            console.error("Error looking up PIN reset code:", error);
            return NextResponse.json({ error: "Internal server error" }, { status: 500 });
        }

        if (!otp) {
            const attempts = baseAttempts + 1;
            const updatePayload: {
                pin_reset_failed_attempts: number;
                pin_reset_locked_until?: string | null;
            } = { pin_reset_failed_attempts: attempts };

            if (attempts >= PIN_LOCKOUT_MAX_ATTEMPTS) {
                updatePayload.pin_reset_locked_until = nextLockoutExpiry();
                await supabaseAdmin
                    .from('users')
                    .update(updatePayload)
                    .eq('id', user.id);
                await invalidateResetCodes(user.id);
                return NextResponse.json(
                    {
                        error: "PIN reset locked due to too many failed attempts",
                        lockedUntil: updatePayload.pin_reset_locked_until,
                    },
                    { status: 423 }
                );
            }

            if (lockExpired) {
                updatePayload.pin_reset_locked_until = null;
            }

            await supabaseAdmin
                .from('users')
                .update(updatePayload)
                .eq('id', user.id);

            return NextResponse.json({ error: "Invalid or expired code" }, { status: 400 });
        }

        await supabaseAdmin
            .from('security_otps')
            .update({ verified: true })
            .eq('id', otp.id);

        await supabaseAdmin
            .from('users')
            .update({ pin_reset_failed_attempts: 0, pin_reset_locked_until: null })
            .eq('id', user.id);

        const token = await createSecuritySessionToken(user.id, 'pin_reset');

        const response = NextResponse.json({ success: true });
        response.cookies.set(
            SECURITY_SESSION_COOKIE_NAME,
            token,
            securitySessionCookieOptions(SECURITY_SESSION_MAX_AGE_SECONDS)
        );

        return response;

    } catch (error) {
        console.error("Error verifying otp:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
