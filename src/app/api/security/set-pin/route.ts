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
        const { pin } = body;

        if (!pin || pin.length !== 6 || !/^\d+$/.test(pin)) {
            return NextResponse.json(
                { error: "PIN must be a 6-digit number" },
                { status: 400 }
            );
        }

        const salt = await bcrypt.genSalt(10);
        const hash = await bcrypt.hash(pin, salt);

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
                { error: "Failed to set security PIN" },
                { status: 500 }
            );
        }

        return NextResponse.json({ success: true });
    } catch (err: unknown) {
        const error = err as Error;
        console.error("Error setting PIN:", error);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}
