import { NextResponse } from 'next/server';
import { createAuthenticatedRouteClient } from '@/lib/supabase-server';

export async function PUT(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { supabase, user } = await createAuthenticatedRouteClient();

    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    try {
        const body = await request.json();
        const { full_name, email, phone_number, relationship_id, notes, notified } = body;

        const updateData: Record<string, unknown> = {};
        if (full_name !== undefined) updateData.full_name = full_name;
        if (email !== undefined) updateData.email = email;
        if (phone_number !== undefined) updateData.phone_number = phone_number;
        if (relationship_id !== undefined) updateData.relationship_id = relationship_id;
        if (notes !== undefined) updateData.notes = notes;
        if (notified !== undefined) updateData.notified = notified;

        const { data, error } = await supabase
            .from('beneficiaries')
            .update(updateData)
            .eq('id', id)
            .eq('user_id', user.id)
            .select('*, relationship:relationships(key)')
            .single();

        if (error) {
            console.error('Supabase error updating beneficiary:', error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json(data);
    } catch {
        return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
}

export async function DELETE(
    _request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { supabase, user } = await createAuthenticatedRouteClient();

    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    // Check if the beneficiary is assigned to any assets
    const { count, error: countError } = await supabase
        .from('digital_assets')
        .select('*', { count: 'exact', head: true })
        .eq('beneficiary_id', id);

    if (countError) {
        console.error('Supabase error checking beneficiary assignments:', countError);
        return NextResponse.json({ error: countError.message }, { status: 500 });
    }

    if (count && count > 0) {
        return NextResponse.json({ error: 'Beneficiary is assigned to assets' }, { status: 409 });
    }

    const { error } = await supabase
        .from('beneficiaries')
        .delete()
        .eq('id', id)
        .eq('user_id', user.id);

    if (error) {
        console.error('Supabase error deleting beneficiary:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
}
