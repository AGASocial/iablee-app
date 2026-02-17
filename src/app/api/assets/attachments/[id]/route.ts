
import { NextResponse } from 'next/server';
import { createAuthenticatedRouteClient } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { decryptUserKey, createDecryptionStream } from '@/lib/encryption';
import { Readable } from 'stream';

// Helper to convert Web ReadableStream to Node Readable
// Helper to convert Web ReadableStream to Node Readable
function webToNodeStream(webStream: ReadableStream<Uint8Array>): Readable {
    return Readable.fromWeb(webStream as unknown as import('stream/web').ReadableStream);
}

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

    // 2. Fetch User Key for Decryption
    // We need the key of the ASSET OWNER, not necessarily the current user (though usually same)
    // But wait, beneficiaries might view assets?
    // The current policy is: "Users can view their own digital assets".
    // If beneficiary logic is added later, we need to fetch the key of the asset owner (digital_assets.user_id)
    const assetOwnerId = attachment.digital_assets.user_id;

    const { data: userData, error: userError } = await supabaseAdmin
        .from('users')
        .select('encrypted_storage_key')
        .eq('id', assetOwnerId)
        .single();

    if (userError || !userData?.encrypted_storage_key) {
        console.error('Error fetching owner key:', userError);
        return NextResponse.json({ error: 'Decryption key not found' }, { status: 500 });
    }

    let userKey: Buffer;
    try {
        userKey = decryptUserKey(userData.encrypted_storage_key);
    } catch (e) {
        console.error('Key decryption failed:', e);
        return NextResponse.json({ error: 'Security error' }, { status: 500 });
    }

    // 3. Fetch file from storage using Admin client
    const { data: fileData, error: storageError } = await supabaseAdmin.storage
        .from('assets')
        .download(attachment.file_path);

    if (storageError || !fileData) {
        console.error('Storage error:', storageError);
        return NextResponse.json({ error: 'File not found in storage' }, { status: 404 });
    }

    // 4. Decrypt Stream
    // fileData is a Blob. We need a stream.
    const fileStream = fileData.stream();
    const nodeStream = webToNodeStream(fileStream);
    const decryptionStream = createDecryptionStream(userKey);
    const decryptedStream = nodeStream.pipe(decryptionStream);

    // 5. Return Decrypted Stream
    const headers = new Headers();
    headers.set('Content-Type', attachment.file_type || fileData.type);

    // Note: Content-Length is NOT known for the decrypted stream (IV/Tag removal)
    // But it is roughly Size - 29 bytes.
    // If we send wrong Content-Length, browser might complain. Better to omit or chunked encoding.
    // headers.set('Content-Length', ...); 

    // Handle non-ASCII characters in filename
    const encodedFilename = encodeURIComponent(attachment.file_name);
    headers.set('Content-Disposition', `inline; filename="${encodedFilename}"; filename*=UTF-8''${encodedFilename}`);
    headers.set('Cache-Control', 'private, max-age=3600');

    // Return the Node stream as the response body. 
    // Next.js/Web Standard Response expects a Web ReadableStream.
    // We can convert Node Stream back to Web Stream OR use the iterator.
    const finalStream = Readable.toWeb(decryptedStream);

    return new NextResponse(finalStream as BodyInit, {
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
