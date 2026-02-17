import { NextResponse } from "next/server";
import { createAuthenticatedRouteClient } from "@/lib/supabase-server";
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST() {
    try {
        const { supabase, user } = await createAuthenticatedRouteClient();

        if (!user || !user.email) {
            return NextResponse.json({ error: "User not authenticated or email missing" }, { status: 401 });
        }

        // Generate 6-digit code
        const code = Math.floor(100000 + Math.random() * 900000).toString();

        // Define expiry (15 mins from now)
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

        // Store OTP in database
        const { error: dbError } = await supabase
            .from('security_otps')
            .insert({
                user_id: user.id,
                code: code, // In a real prod app, consider hashing this. For MVP/Security PIN reset, plain might be acceptable if short lived. 
                // However, plain text OTP in DB is a risk if DB is compromised. 
                // But since it's just for PIN reset and not full account takeover (assuming PIN doesn't guard login), it might be a calculated risk.
                // Let's stick to plain for now for simplicity as per plan, but acknowledge risk.
                expires_at: expiresAt,
                verified: false
            });

        if (dbError) {
            console.error("Error storing OTP:", dbError);
            return NextResponse.json({ error: "Failed to generate OTP" }, { status: 500 });
        }

        // Send Email via Resend
        const { error: emailError } = await resend.emails.send({
            from: 'Iablee Security <security@security.iablee.com>',
            to: [user.email],
            subject: 'Your Security PIN Reset Code',
            html: `<p>Your security code is: <strong>${code}</strong></p><p>This code will expire in 15 minutes.</p>`
        });

        if (emailError) {
            console.error("Error sending email:", emailError);
            return NextResponse.json({ error: `Failed to send email: ${emailError.message}`, details: emailError }, { status: 500 });
        }

        return NextResponse.json({ success: true, message: "OTP sent" });

    } catch (error) {
        console.error("Error in forgot-pin:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
