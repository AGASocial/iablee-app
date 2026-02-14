import { NextResponse } from 'next/server';
import { createAuthenticatedRouteClient } from '@/lib/supabase-server';
import { canCreateAsset } from '@/lib/subscription/limits';

export async function GET() {
    const { supabase, user } = await createAuthenticatedRouteClient();

    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data, error } = await supabase
        .from('digital_assets')
        .select('id, asset_name, asset_type, status, email, password, website, valid_until, description, files, custom_fields, beneficiary_id, beneficiary:beneficiary_id(id, full_name), asset_type_details:asset_type(id, name, description, icon)')
        .eq('user_id', user.id)
        .order('asset_name', { ascending: true });

    if (error) {
        console.error('Supabase error fetching digital_assets:', error);
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

        const { data, error } = await supabase
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
                custom_fields: custom_fields && Object.keys(custom_fields).length > 0 ? custom_fields : null,
            })
            .select()
            .single();

        if (error) {
            console.error('Supabase error creating asset:', error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        // Create asset_attachments records for each uploaded file
        if (fileMetadata && Array.isArray(fileMetadata) && fileMetadata.length > 0) {
            const attachmentRows = fileMetadata.map((fm: { path: string; fileName: string; fileType: string; fileSize: number }) => ({
                asset_id: data.id,
                file_path: fm.path,
                file_name: fm.fileName,
                file_type: fm.fileType,
                file_size: fm.fileSize,
            }));

            const { error: attachError } = await supabase
                .from('asset_attachments')
                .insert(attachmentRows);

            if (attachError) {
                console.error('Error creating asset attachments:', attachError);
                // Don't fail the whole request — asset was created. Log and continue.
            }
        }

        return NextResponse.json(data, { status: 201 });
    } catch {
        return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
}
