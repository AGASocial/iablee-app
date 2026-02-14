
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { Database } from '@/lib/supabase';
import { supabaseAdmin } from '@/lib/supabase-admin';

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const id = (await params).id;
    const cookieStore = await cookies();
    const supabase = createRouteHandlerClient<Database>({ cookies: async () => cookieStore });

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 1. Get attachment details and verify access
    // We use the standard client so RLS applies.
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
    const cookieStore = await cookies();
    const supabase = createRouteHandlerClient<Database>({ cookies: async () => cookieStore });

    const { data: { user } } = await supabase.auth.getUser();
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

    // 3. Delete from Storage (using Admin because RLS checks might be tricky or we want to ensure cleanup)
    // Actually, we should probably use the same user client if they have storage permissions,
    // but let's use Admin to ensure it's cleaned up even if storage policies are restrictive.
    const { error: storageError } = await supabaseAdmin.storage
        .from('assets')
        .remove([attachment.file_path]);

    if (storageError) {
        console.error('Error deleting file from storage:', storageError);
        // We already deleted from DB, so we can't really rollback easily.
        // Just log it.
    }

    return NextResponse.json({ success: true });
}
