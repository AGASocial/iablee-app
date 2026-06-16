import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedContext } from '@/lib/auth-context';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { canCreateAsset } from '@/lib/subscription/limits';
import { parsePaginationParams, buildPaginatedResponse } from '@/lib/pagination';
import { withTiming } from '@/lib/observability';

/**
 * GET /api/assets
 *
 * Paginated list of digital assets.
 * Query params: limit (default 20, max 100), cursor (base64url JSON { id, sortValue })
 * Response: { data: Asset[], pagination: { limit, hasMore, nextCursor } }
 *
 * List view excludes decrypted_password and decrypted_custom_fields.
 * Use GET /api/assets/[assetId] for full detail including credentials.
 */
export const GET = withTiming('GET /api/assets', async (request: NextRequest) => {
    const auth = await getAuthenticatedContext();
    if (!auth.ok) {
        return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const { user } = auth.ctx;

    const { limit, cursor } = parsePaginationParams(request.nextUrl.searchParams);

    let query = supabaseAdmin
        .from('decrypted_digital_assets')
        .select('id, asset_name, asset_type, status, email, website, valid_until, description, files, beneficiary_id, beneficiary:beneficiary_id(id, full_name), asset_type_details:asset_type(id, name, description, icon)')
        .eq('user_id', user.id)
        .order('asset_name', { ascending: true })
        .order('id', { ascending: true })
        .limit(limit + 1);

    if (cursor) {
        query = query.or(
            `asset_name.gt.${cursor.sortValue},and(asset_name.eq.${cursor.sortValue},id.gt.${cursor.id})`
        );
    }

    const { data, error } = await query;

    if (error) {
        console.error('Supabase error fetching digital_assets:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const result = buildPaginatedResponse(data ?? [], limit, (row) => ({
        id: row.id as string,
        sortValue: row.asset_name as string,
    }));

    return NextResponse.json(result);
});

export const POST = withTiming('POST /api/assets', async (request: Request) => {
    const auth = await getAuthenticatedContext();
    if (!auth.ok) {
        return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const { supabase, user } = auth.ctx;

    try {
        const limitCheck = await canCreateAsset(supabase, user.id);
        if (!limitCheck.allowed) {
            return NextResponse.json(
                { error: 'LIMIT_REACHED', message: limitCheck.reason, limit: limitCheck.limit, current: limitCheck.current },
                { status: 403 }
            );
        }

        const body = await request.json();
        const {
            asset_type, asset_name, email, password, website,
            valid_until, description, files, custom_fields, fileMetadata
        } = body;

        if (!asset_name || !asset_type) {
            return NextResponse.json({ error: 'asset_name and asset_type are required' }, { status: 400 });
        }

        const { data, error } = await supabaseAdmin
            .from('digital_assets')
            .insert({
                user_id: user.id,
                asset_type,
                asset_name,
                email: email || null,
                password: password || null,
                website: website || null,
                valid_until: valid_until || null,
                description: description || null,
                files: files && files.length > 0 ? files : null,
                custom_fields: custom_fields && Object.keys(custom_fields).length > 0 ? JSON.stringify(custom_fields) : null,
            })
            .select()
            .single();

        if (error) {
            console.error('Supabase error creating asset:', error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        if (fileMetadata && Array.isArray(fileMetadata) && fileMetadata.length > 0) {
            const attachmentRows = fileMetadata.map((fm: { path: string; fileName: string; fileType: string; fileSize: number }) => ({
                asset_id: data.id,
                file_path: fm.path,
                file_name: fm.fileName,
                file_type: fm.fileType,
                file_size: fm.fileSize,
            }));

            const { error: attachError } = await supabaseAdmin
                .from('asset_attachments')
                .insert(attachmentRows);

            if (attachError) {
                console.error('Error creating asset attachments:', attachError);
            }
        }

        return NextResponse.json(data, { status: 201 });
    } catch {
        return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
});
