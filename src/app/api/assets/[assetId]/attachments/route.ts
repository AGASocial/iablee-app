
import { NextResponse } from 'next/server';
import { createAuthenticatedRouteClient } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { canUploadFile } from '@/lib/subscription/limits';
import { resolveVerifiedAttachmentSize } from '@/lib/storage/verify-attachment-size';
import {
    isStorageQuotaDbError,
    storageLimitReachedResponse,
} from '@/lib/subscription/storage-quota-response';

export async function GET(
    request: Request,
    { params }: { params: Promise<{ assetId: string }> }
) {
    const assetId = (await params).assetId;
    const { supabase, user } = await createAuthenticatedRouteClient();

    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data, error } = await supabase
        .from('asset_attachments')
        .select('*')
        .eq('asset_id', assetId)
        .order('created_at', { ascending: false });

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
}

export async function POST(
    request: Request,
    { params }: { params: Promise<{ assetId: string }> }
) {
    const assetId = (await params).assetId;
    const { supabase, user } = await createAuthenticatedRouteClient();

    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const json = await request.json();
    const { file_path, file_name, file_type, file_size } = json;

    if (!file_path || !file_name) {
        return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const clientSize =
        typeof file_size === 'number' ? file_size : file_size != null ? Number(file_size) : null;

    const verified = await resolveVerifiedAttachmentSize(
        supabaseAdmin,
        user.id,
        file_path,
        clientSize
    );
    if (!verified.ok) {
        return NextResponse.json({ error: verified.error }, { status: verified.status });
    }

    const storageCheck = await canUploadFile(supabase, user.id, verified.size);
    if (!storageCheck.allowed) {
        return storageLimitReachedResponse(supabase, user.id, {
            limit: storageCheck.limit,
            current: storageCheck.current,
        });
    }

    const { data, error } = await supabase
        .from('asset_attachments')
        .insert({
            asset_id: assetId,
            file_path,
            file_name,
            file_type,
            file_size: verified.size,
        })
        .select()
        .single();

    if (error) {
        if (isStorageQuotaDbError(error.message)) {
            return storageLimitReachedResponse(supabase, user.id, {
                limit: storageCheck.limit,
                current: storageCheck.current,
            });
        }
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
}
