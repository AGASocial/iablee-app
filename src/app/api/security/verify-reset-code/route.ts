import { NextRequest, NextResponse } from "next/server";
import { createAuthenticatedRouteClient } from "@/lib/supabase-server";
import { createSecuritySessionToken } from "@/lib/security";

export async function POST(req: NextRequest) {
    try {
        const { code } = await req.json();
        const { supabase, user } = await createAuthenticatedRouteClient();

        if (!user || !user.id) {
            return NextResponse.json({ error: "User not authenticated" }, { status: 401 });
        }

        // Verify OTP
        const { data: otp, error } = await supabase
            .from('security_otps')
            .select('*')
            .eq('user_id', user.id)
            .eq('code', code)
            .eq('verified', false)
            .gt('expires_at', new Date().toISOString())
            .single();

        if (error || !otp) {
            return NextResponse.json({ error: "Invalid or expired code" }, { status: 400 });
        }

        // Mark OTP as verified (optional, or just delete it)
        await supabase
            .from('security_otps')
            .update({ verified: true })
            .eq('id', otp.id);

        // Generate Security Session Token
        const token = await createSecuritySessionToken(user.id);

        // Optionally, reset PIN directly here OR just return token to allow user to set new PIN via separate route.
        // Actually, the plan is to verify -> get token -> force user to "Reset PIN" UI (which calls /api/security/set-pin).
        // Since we have the token, we can return it.
        // But wait, the client needs to set the cookie.
        // We should set the cookie here.

        const response = NextResponse.json({ success: true });
        response.cookies.set('security_session', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 15 * 60 // 15 mins
        });

        return response;

    } catch (error) {
        console.error("Error verifying otp:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
