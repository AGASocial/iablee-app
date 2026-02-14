import { NextResponse } from 'next/server';
import { createAuthenticatedRouteClient } from '@/lib/supabase-server';

export async function PUT(
    request: Request,
    { params }: { params: Promise<{ assetId: string }> }
) {
    const { supabase, user } = await createAuthenticatedRouteClient();

    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { assetId } = await params;

    try {
        const body = await request.json();
        const {
            asset_type, asset_name, email, password, website,
            valid_until, description, files, custom_fields,
            beneficiary_id, status, fileMetadata
        } = body;

        const updateData: Record<string, unknown> = {};
        if (asset_type !== undefined) updateData.asset_type = asset_type;
        if (asset_name !== undefined) updateData.asset_name = asset_name;
        if (email !== undefined) updateData.email = email;
        if (password !== undefined) updateData.password = password;
        if (website !== undefined) updateData.website = website;
        if (valid_until !== undefined) updateData.valid_until = valid_until;
        if (description !== undefined) updateData.description = description;
        if (files !== undefined) updateData.files = files;
        if (custom_fields !== undefined) updateData.custom_fields = custom_fields;
        if (beneficiary_id !== undefined) updateData.beneficiary_id = beneficiary_id;
        if (status !== undefined) updateData.status = status;

        const { data, error } = await supabase
            .from('digital_assets')
            .update(updateData)
            .eq('id', assetId)
            .eq('user_id', user.id)
            .select()
            .single();

        if (error) {
            console.error('Supabase error updating asset:', error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        // Create asset_attachments records for newly uploaded files
        if (fileMetadata && Array.isArray(fileMetadata) && fileMetadata.length > 0) {
            const attachmentRows = fileMetadata.map((fm: { path: string; fileName: string; fileType: string; fileSize: number }) => ({
                asset_id: assetId,
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
            }
        }

        return NextResponse.json(data);
    } catch {
        return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
}

export async function DELETE(
    _request: Request,
    { params }: { params: Promise<{ assetId: string }> }
) {
    const { supabase, user } = await createAuthenticatedRouteClient();

    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { assetId } = await params;

    const { error } = await supabase
        .from('digital_assets')
        .delete()
        .eq('id', assetId)
        .eq('user_id', user.id);

    if (error) {
        console.error('Supabase error deleting asset:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
}
