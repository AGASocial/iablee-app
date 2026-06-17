import { NextResponse } from 'next/server';
import { getAuthenticatedContext } from '@/lib/auth-context';
import {
    maybeSendBeneficiaryVerificationEmail,
} from '@/lib/beneficiary-verification-flow';

export async function PUT(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await getAuthenticatedContext();
    if (!auth.ok) {
        return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const { supabase, user } = auth.ctx;

    const { id } = await params;

    try {
        const { data: existing, error: existingError } = await supabase
            .from('beneficiaries')
            .select('id, email, email_verified, email_verified_at')
            .eq('id', id)
            .eq('user_id', user.id)
            .single();

        if (existingError || !existing) {
            return NextResponse.json({ error: 'Beneficiary not found' }, { status: 404 });
        }

        const body = await request.json();
        const { full_name, email, phone_number, relationship_id, notes, locale } = body;

        const normalizedEmail = email !== undefined ? (email?.trim() || null) : undefined;
        const emailChanged =
            normalizedEmail !== undefined &&
            (normalizedEmail ?? '').toLowerCase() !== (existing.email?.trim().toLowerCase() ?? '');

        const updateData: Record<string, unknown> = {};
        if (full_name !== undefined) updateData.full_name = full_name;
        if (normalizedEmail !== undefined) updateData.email = normalizedEmail;
        if (phone_number !== undefined) updateData.phone_number = phone_number;
        if (relationship_id !== undefined) updateData.relationship_id = relationship_id;
        if (notes !== undefined) updateData.notes = notes;

        if (emailChanged) {
            updateData.email_verified = false;
            updateData.email_verified_at = null;
            updateData.notified = false;
            updateData.last_notified_at = null;
        }

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

        const { verificationSent } = await maybeSendBeneficiaryVerificationEmail({
            supabase,
            userId: user.id,
            beneficiaryId: data.id,
            beneficiaryName: data.full_name,
            email: data.email,
            emailChanged,
            isNew: false,
            locale,
        });

        return NextResponse.json({ ...data, verificationSent });
    } catch {
        return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
}

export async function DELETE(
    _request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await getAuthenticatedContext();
    if (!auth.ok) {
        return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const { supabase, user } = auth.ctx;

    const { id } = await params;

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
