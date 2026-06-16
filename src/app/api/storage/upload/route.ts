import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedContext } from '@/lib/auth-context';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getSubscriptionLimits } from '@/lib/subscription/limits';
import { checkRateLimit, getClientIp, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import {
    encryptUserKey,
    generateUserKey,
    decryptUserKey,
    createEncryptionStream,
} from '@/lib/encryption';
import { Readable } from 'stream';

/** Per-request cache for user encryption key lookup */
const requestKeyCache = new Map<string, Buffer>();

async function getUserStorageKey(userId: string): Promise<Buffer> {
  const cached = requestKeyCache.get(userId);
  if (cached) return cached;

  const { data: userData, error: userError } = await supabaseAdmin
    .from('users')
    .select('encrypted_storage_key')
    .eq('id', userId)
    .single();

  if (userError) {
    throw new Error('Failed to fetch user storage key');
  }

  let storageKey: Buffer;

  if (!userData?.encrypted_storage_key) {
    const newKey = generateUserKey();
    const encryptedKey = encryptUserKey(newKey);

    await supabaseAdmin
      .from('users')
      .update({ encrypted_storage_key: encryptedKey })
      .eq('id', userId)
      .is('encrypted_storage_key', null);

    const { data: finalUserData } = await supabaseAdmin
      .from('users')
      .select('encrypted_storage_key')
      .eq('id', userId)
      .single();

    if (!finalUserData?.encrypted_storage_key) {
      throw new Error('Failed to generate/retrieve user storage key');
    }

    storageKey = decryptUserKey(finalUserData.encrypted_storage_key);
  } else {
    storageKey = decryptUserKey(userData.encrypted_storage_key);
  }

  requestKeyCache.set(userId, storageKey);
  return storageKey;
}

export async function POST(request: NextRequest) {
    const ip = getClientIp(request);
    const rateLimit = checkRateLimit(`upload:${ip}`, RATE_LIMITS.upload);
    if (!rateLimit.allowed) {
        return rateLimitResponse(rateLimit.resetAt);
    }

    const auth = await getAuthenticatedContext();
    if (!auth.ok) {
        return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const { user, supabase } = auth.ctx;

    const userRateLimit = checkRateLimit(`upload:user:${user.id}`, RATE_LIMITS.upload);
    if (!userRateLimit.allowed) {
        return rateLimitResponse(userRateLimit.resetAt);
    }

    try {
        const formData = await request.formData();
        const file = formData.get('file') as File;

        if (!file) {
            return NextResponse.json({ error: 'No file provided' }, { status: 400 });
        }

        const limits = await getSubscriptionLimits(supabase, user.id);
        const maxBytes = limits.maxFileSizeMb * 1024 * 1024;
        if (file.size > maxBytes) {
            return NextResponse.json(
                { error: `File exceeds maximum size of ${limits.maxFileSizeMb}MB` },
                { status: 413 }
            );
        }

        if (!file.stream) {
            return NextResponse.json(
                { error: 'Streaming upload required; non-stream files are rejected' },
                { status: 400 }
            );
        }

        const storageKey = await getUserStorageKey(user.id);

        const fileStream = Readable.fromWeb(
            file.stream() as unknown as import('stream/web').ReadableStream
        );
        const encryptionStream = createEncryptionStream(storageKey);
        const encryptedStream = fileStream.pipe(encryptionStream);

        const safeFileName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
        const filePath = `${user.id}/${Date.now()}-${safeFileName}`;

        const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
            .from('assets')
            .upload(filePath, encryptedStream as unknown as BodyInit, {
                duplex: 'half',
                contentType: file.type,
            });

        if (uploadError) {
            console.error('Storage upload error:', uploadError);
            return NextResponse.json({ error: uploadError.message }, { status: 500 });
        }

        return NextResponse.json(
            {
                path: uploadData.path,
                fileName: safeFileName,
                originalName: file.name,
                fileType: file.type,
                fileSize: file.size,
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
