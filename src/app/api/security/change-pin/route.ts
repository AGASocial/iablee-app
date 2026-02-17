import { NextRequest, NextResponse } from "next/server";
import { createAuthenticatedRouteClient } from "@/lib/supabase-server";
import bcrypt from "bcryptjs";

export async function POST(req: NextRequest) {
    try {
        const { supabase, user } = await createAuthenticatedRouteClient();

        if (!user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await req.json();
        const { currentPin, newPin } = body;

        if (!newPin || newPin.length !== 6 || !/^\d+$/.test(newPin)) {
            return NextResponse.json(
                { error: "New PIN must be a 6-digit number" },
                { status: 400 }
            );
        }

        // 1. Verify Current PIN
        const { data: userData, error: fetchError } = await supabase
            .from("users")
            .select("security_pin_hash")
            .eq("id", user.id)
            .single();

        if (fetchError || !userData) {
            console.error("Error fetching user data:", fetchError);
            return NextResponse.json(
                { error: "Failed to verify current PIN" },
                { status: 500 }
            );
        }

        // If user has a PIN set, they must provide the correct current PIN
        if (userData.security_pin_hash) {
            if (!currentPin) {
                return NextResponse.json(
                    { error: "Current PIN is required" },
                    { status: 400 }
                );
            }
            const isValid = await bcrypt.compare(currentPin, userData.security_pin_hash);
            if (!isValid) {
                return NextResponse.json({ error: "Incorrect current PIN" }, { status: 401 });
            }
        }

        // 2. Set New PIN
        const salt = await bcrypt.genSalt(10);
        const hash = await bcrypt.hash(newPin, salt);

        const { error: updateError } = await supabase
            .from("users")
            .update({
                security_pin_hash: hash,
                security_pin_updated_at: new Date().toISOString(),
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
        // ... error handling
        const error = err as Error;
        console.error("Error changing PIN:", error);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}
