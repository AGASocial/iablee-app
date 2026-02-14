
import { NextResponse } from 'next/server';
import { createAuthenticatedRouteClient } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase-admin';

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const id = (await params).id;
    const { supabase, user } = await createAuthenticatedRouteClient();

    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 1. Get attachment details and verify access
    const { data: attachment, error: fetchError } = await supabase
        .from('asset_attachments')
        .select('*, digital_assets!inner(user_id)')
        .eq('id', id)
        .single();

    if (fetchError || !attachment) {
        return NextResponse.json({ error: 'Not found or permission denied' }, { status: 404 });
    }

    // 2. Fetch file from storage using Admin client
    const { data: fileData, error: storageError } = await supabaseAdmin.storage
        .from('assets')
        .download(attachment.file_path);

    if (storageError || !fileData) {
        console.error('Storage error:', storageError);
        return NextResponse.json({ error: 'File not found in storage' }, { status: 404 });
    }

    // 3. Return file stream
    const headers = new Headers();
    headers.set('Content-Type', fileData.type);
    headers.set('Content-Length', fileData.size.toString());
    headers.set('Content-Disposition', `inline; filename="${attachment.file_name}"`);
    headers.set('Cache-Control', 'private, max-age=3600');

    return new NextResponse(fileData, {
        status: 200,
        headers,
    });
}

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const id = (await params).id;
    const { supabase, user } = await createAuthenticatedRouteClient();

    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 1. Get attachment to know the file path
    const { data: attachment, error: fetchError } = await supabase
        .from('asset_attachments')
        .select('file_path')
        .eq('id', id)
        .single();

    if (fetchError || !attachment) {
        return NextResponse.json({ error: 'Not found or permission denied' }, { status: 404 });
    }

    // 2. Delete from DB (RLS ensures owner)
    const { error: dbError } = await supabase
        .from('asset_attachments')
        .delete()
        .eq('id', id);

    if (dbError) {
        return NextResponse.json({ error: dbError.message }, { status: 500 });
    }

    // 3. Delete from Storage using Admin to ensure cleanup
    const { error: storageError } = await supabaseAdmin.storage
        .from('assets')
        .remove([attachment.file_path]);

    if (storageError) {
        console.error('Error deleting file from storage:', storageError);
    }

    return NextResponse.json({ success: true });
}
