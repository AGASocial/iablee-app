import { NextResponse } from 'next/server';
import { createAuthenticatedRouteClient } from '@/lib/supabase-server';
import { canCreateBeneficiary } from '@/lib/subscription/limits';

export async function GET() {
    const { supabase, user } = await createAuthenticatedRouteClient();

    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data, error } = await supabase
        .from('beneficiaries')
        .select('*, relationship:relationships(key)')
        .eq('user_id', user.id)
        .order('full_name', { ascending: true });

    if (error) {
        console.error('Supabase error fetching beneficiaries:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
}

export async function POST(request: Request) {
    const { supabase, user } = await createAuthenticatedRouteClient();

    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        // Enforce subscription limit
        const limitCheck = await canCreateBeneficiary(supabase, user.id);
        if (!limitCheck.allowed) {
            return NextResponse.json(
                { error: 'LIMIT_REACHED', message: limitCheck.reason, limit: limitCheck.limit, current: limitCheck.current },
                { status: 403 }
            );
        }

        const body = await request.json();
        const { full_name, email, phone_number, relationship_id, notes, notified } = body;

        if (!full_name) {
            return NextResponse.json({ error: 'full_name is required' }, { status: 400 });
        }

        const { data, error } = await supabase
            .from('beneficiaries')
            .insert({
                user_id: user.id,
                full_name,
                email: email || null,
                phone_number: phone_number || null,
                relationship_id: relationship_id || null,
                notes: notes || null,
                notified: notified || false,
                status: 'active',
            })
            .select('*, relationship:relationships(key)')
            .single();

        if (error) {
            console.error('Supabase error creating beneficiary:', error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json(data, { status: 201 });
    } catch {
        return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
}
