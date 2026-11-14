import { NextRequest, NextResponse } from "next/server";
import { createAuthenticatedRouteClient } from "@/lib/supabase-server";
import { getPasswordPolicyError } from "@/lib/password-policy";

export async function POST(req: NextRequest) {
    try {
        const { supabase, user } = await createAuthenticatedRouteClient();

        if (!user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await req.json();
        const { newPassword } = body;

        if (!newPassword || typeof newPassword !== "string") {
            return NextResponse.json({ error: "Password is required" }, { status: 400 });
        }

        const policyError = getPasswordPolicyError(newPassword, { email: user.email });
        if (policyError) {
            return NextResponse.json({ error: policyError }, { status: 400 });
        }

        const { error } = await supabase.auth.updateUser({
            password: newPassword
        });

        if (error) {
            console.error("Error changing password:", error);
            return NextResponse.json({ error: "Failed to change password" }, { status: 500 });
        }

        return NextResponse.json({ success: true });

    } catch (err: unknown) {
        const error = err as Error;
        console.error("Error changing password:", error);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}
