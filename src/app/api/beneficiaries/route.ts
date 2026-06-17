import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedContext } from '@/lib/auth-context';
import { canCreateBeneficiary } from '@/lib/subscription/limits';
import { parsePaginationParams, buildPaginatedResponse } from '@/lib/pagination';
import { withTiming } from '@/lib/observability';
import {
    maybeSendBeneficiaryVerificationEmail,
} from '@/lib/beneficiary-verification-flow';

/**
 * GET /api/beneficiaries
 *
 * Paginated list of beneficiaries.
 * Query params: limit (default 20, max 100), cursor (base64url JSON { id, sortValue })
 * Response: { data: Beneficiary[], pagination: { limit, hasMore, nextCursor } }
 */
export const GET = withTiming('GET /api/beneficiaries', async (request: NextRequest) => {
    const auth = await getAuthenticatedContext();
    if (!auth.ok) {
        return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const { supabase, user } = auth.ctx;

    const { limit, cursor } = parsePaginationParams(request.nextUrl.searchParams);

    let query = supabase
        .from('beneficiaries')
        .select('*, relationship:relationships(key)')
        .eq('user_id', user.id)
        .order('full_name', { ascending: true })
        .order('id', { ascending: true })
        .limit(limit + 1);

    if (cursor) {
        query = query.or(
            `full_name.gt.${cursor.sortValue},and(full_name.eq.${cursor.sortValue},id.gt.${cursor.id})`
        );
    }

    const { data, error } = await query;

    if (error) {
        console.error('Supabase error fetching beneficiaries:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const result = buildPaginatedResponse(data ?? [], limit, (row) => ({
        id: row.id as string,
        sortValue: row.full_name as string,
    }));

    return NextResponse.json(result);
});

export const POST = withTiming('POST /api/beneficiaries', async (request: Request) => {
    const auth = await getAuthenticatedContext();
    if (!auth.ok) {
        return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const { supabase, user } = auth.ctx;

    try {
        const limitCheck = await canCreateBeneficiary(supabase, user.id);
        if (!limitCheck.allowed) {
            return NextResponse.json(
                { error: 'LIMIT_REACHED', message: limitCheck.reason, limit: limitCheck.limit, current: limitCheck.current },
                { status: 403 }
            );
        }

        const body = await request.json();
        const { full_name, email, phone_number, relationship_id, notes, locale } = body;

        if (!full_name) {
            return NextResponse.json({ error: 'full_name is required' }, { status: 400 });
        }

        const normalizedEmail = email?.trim() || null;

        const { data, error } = await supabase
            .from('beneficiaries')
            .insert({
                user_id: user.id,
                full_name,
                email: normalizedEmail,
                phone_number: phone_number || null,
                relationship_id: relationship_id || null,
                notes: notes || null,
                notified: false,
                email_verified: false,
                email_verified_at: null,
                status: 'active',
            })
            .select('*, relationship:relationships(key)')
            .single();

        if (error) {
            console.error('Supabase error creating beneficiary:', error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        const { verificationSent } = await maybeSendBeneficiaryVerificationEmail({
            supabase,
            userId: user.id,
            beneficiaryId: data.id,
            beneficiaryName: data.full_name,
            email: normalizedEmail,
            emailChanged: true,
            isNew: true,
            locale,
        });

        return NextResponse.json({ ...data, verificationSent }, { status: 201 });
    } catch {
        return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
});
