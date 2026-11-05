import { NextRequest, NextResponse } from "next/server";
import { createAuthenticatedRouteClient } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { checkRateLimit, getClientIp, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { generatePinResetCode, hashPinResetCode } from "@/lib/pin-reset-otp";
import { isPinLocked } from "@/lib/pin-lockout";
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(request: NextRequest) {
    try {
        const ip = getClientIp(request);
        const rateLimit = checkRateLimit(`security:forgot-pin:${ip}`, RATE_LIMITS.securityPin);
        if (!rateLimit.allowed) {
            return rateLimitResponse(rateLimit.resetAt);
        }

        const { user } = await createAuthenticatedRouteClient();

        if (!user || !user.email) {
            return NextResponse.json({ error: "User not authenticated or email missing" }, { status: 401 });
        }

        const userRateLimit = checkRateLimit(
            `security:forgot-pin:user:${user.id}`,
            RATE_LIMITS.securityPin
        );
        if (!userRateLimit.allowed) {
            return rateLimitResponse(userRateLimit.resetAt);
        }

        const { data: userData, error: userError } = await supabaseAdmin
            .from('users')
            .select('pin_reset_locked_until')
            .eq('id', user.id)
            .single();

        if (userError || !userData) {
            console.error("Error fetching PIN reset lockout:", userError);
            return NextResponse.json({ error: "Failed to generate OTP" }, { status: 500 });
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

        const code = generatePinResetCode();
        const codeHash = hashPinResetCode(code);
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

        const { error: invalidateError } = await supabaseAdmin
            .from('security_otps')
            .update({ verified: true, expires_at: new Date().toISOString() })
            .eq('user_id', user.id)
            .eq('verified', false);

        if (invalidateError) {
            console.error("Error invalidating previous PIN reset codes:", invalidateError);
            return NextResponse.json({ error: "Failed to generate OTP" }, { status: 500 });
        }

        const { error: dbError } = await supabaseAdmin
            .from('security_otps')
            .insert({
                user_id: user.id,
                code: codeHash,
                expires_at: expiresAt,
                verified: false
            });

        if (dbError) {
            console.error("Error storing OTP:", dbError);
            return NextResponse.json({ error: "Failed to generate OTP" }, { status: 500 });
        }

        const { error: emailError } = await resend.emails.send({
            from: 'Iablee Security <security@security.iablee.com>',
            to: [user.email],
            subject: 'Your Security PIN Reset Code',
            html: `<p>Your security code is: <strong>${code}</strong></p><p>This code will expire in 15 minutes.</p>`
        });

        if (emailError) {
            console.error("Error sending email:", emailError);
            return NextResponse.json({ error: "Failed to send email" }, { status: 500 });
        }

        return NextResponse.json({ success: true, message: "OTP sent" });

    } catch (error) {
        console.error("Error in forgot-pin:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
