
import { NextResponse } from 'next/server';
import { createAuthenticatedRouteClient } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import {
    encryptUserKey,
    generateUserKey,
    decryptUserKey,
    createEncryptionStream,
} from '@/lib/encryption';
import { Readable } from 'stream';

export async function POST(request: Request) {
    const { user } = await createAuthenticatedRouteClient();

    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const formData = await request.formData();
        const file = formData.get('file') as File;

        if (!file) {
            return NextResponse.json({ error: 'No file provided' }, { status: 400 });
        }

        // --- 1. Get or Create User Key (Atomic-ish) ---
        // Fetch current key
        const { data: userData, error: userError } = await supabaseAdmin
            .from('users')
            .select('encrypted_storage_key')
            .eq('id', user.id)
            .single();

        if (userError) {
            console.error('Error fetching user key:', userError);
            return NextResponse.json(
                { error: 'Internal Server Error' },
                { status: 500 }
            );
        }

        let storageKey: Buffer;

        if (!userData?.encrypted_storage_key) {
            // Generate new key
            const newKey = generateUserKey();
            const encryptedKey = encryptUserKey(newKey);

            // Save to DB (Only if still null - simple race condition check)
            await supabaseAdmin
                .from('users')
                .update({ encrypted_storage_key: encryptedKey })
                .eq('id', user.id)
                .is('encrypted_storage_key', null); // Conditional update

            // Fetch again to ensure we use the committed key (ours or someone else's)
            const { data: finalUserData } = await supabaseAdmin
                .from('users')
                .select('encrypted_storage_key')
                .eq('id', user.id)
                .single();

            if (!finalUserData?.encrypted_storage_key) {
                throw new Error('Failed to generate/retrieve user storage key');
            }

            storageKey = decryptUserKey(finalUserData.encrypted_storage_key);
        } else {
            storageKey = decryptUserKey(userData.encrypted_storage_key);
        }

        // --- 2. Prepare Encryption Stream ---

        // Convert File to Web Stream -> Node Stream
        const fileStream = file.stream
            ? Readable.fromWeb(file.stream() as unknown as import('stream/web').ReadableStream)
            : Readable.from(Buffer.from(await file.arrayBuffer()));

        const encryptionStream = createEncryptionStream(storageKey);

        // Pipe: File -> Encrypt
        const encryptedStream = fileStream.pipe(encryptionStream);

        // --- 3. Upload to Supabase ---
        // We need 'duplex: "half"' for Node fetch with streams, Supabase client handles this mostly
        // But Supabase storage.upload expects a BodyInit.
        // In Node 18+, ReadableStream is supported.
        // However, `encryptedStream` is a Node Transform stream. We might need to convert it back to Web ReadableStream
        // or pass it as is if Supabase JS client supports Node Streams (it does via 'duplex').

        // Sanitize file name
        const safeFileName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
        const filePath = `${user.id}/${Date.now()}-${safeFileName}`;

        const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
            .from('assets')
            .upload(filePath, encryptedStream as unknown as BodyInit, {
                duplex: 'half', // Required for streaming uploads in Node
                contentType: file.type,
            });

        if (uploadError) {
            console.error('Storage upload error:', uploadError);
            return NextResponse.json({ error: uploadError.message }, { status: 500 });
        }

        return NextResponse.json(
            {
                path: uploadData.path,
                fileName: safeFileName, // Return the sanitized name for the DB record
                originalName: file.name, // Keep original if needed for UI, but primary name is now safe
                fileType: file.type,
                fileSize: file.size, // Note: Encrypted size is slightly larger, but we return original for UI?
                // Actually, returning original size is fine for UI, but maybe we should note it.
            },
            { status: 201 }
        );
    } catch (err: unknown) {
        const error = err as Error;
        console.error('Upload processing error:', error);
        return NextResponse.json(
            { error: 'Failed to process upload' },
            { status: 400 }
        );
    }
}
