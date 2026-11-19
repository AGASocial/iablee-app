import { NextResponse } from 'next/server';
import { createAuthenticatedRouteClient } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import {
    canCreateVideoAsset,
    canUploadFile,
    isVideoAssetType,
} from '@/lib/subscription/limits';
import { buildVerifiedAttachmentRows } from '@/lib/storage/verify-attachment-size';
import {
    isStorageQuotaDbError,
    storageLimitReachedResponse,
} from '@/lib/subscription/storage-quota-response';

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

        // Enforce video cap when a type change would turn a non-video into a video.
        if (asset_type !== undefined) {
            const { data: existing, error: existingError } = await supabaseAdmin
                .from('digital_assets')
                .select('asset_type')
                .eq('id', assetId)
                .eq('user_id', user.id)
                .maybeSingle();

            if (existingError) {
                console.error('Supabase error fetching asset for update:', existingError);
                return NextResponse.json({ error: existingError.message }, { status: 500 });
            }
            if (!existing) {
                return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
            }

            const becomingVideo = await isVideoAssetType(supabase, asset_type);
            if (becomingVideo) {
                const alreadyVideo = await isVideoAssetType(supabase, existing.asset_type as string);
                if (!alreadyVideo) {
                    const videoCheck = await canCreateVideoAsset(supabase, user.id);
                    if (!videoCheck.allowed) {
                        return NextResponse.json(
                            {
                                error: 'LIMIT_REACHED',
                                message: videoCheck.reason,
                                limit: videoCheck.limit,
                                current: videoCheck.current,
                            },
                            { status: 403 }
                        );
                    }
                }
            }
        }

        const updateData: Record<string, unknown> = {};
        if (asset_type !== undefined) updateData.asset_type = asset_type;
        if (asset_name !== undefined) updateData.asset_name = asset_name;
        if (email !== undefined) updateData.email = email;
        if (password !== undefined) updateData.password = password;
        if (website !== undefined) updateData.website = website;
        if (valid_until !== undefined) updateData.valid_until = valid_until;
        if (description !== undefined) updateData.description = description;
        if (files !== undefined) updateData.files = files;
        if (custom_fields !== undefined) updateData.custom_fields = custom_fields ? JSON.stringify(custom_fields) : null;
        if (beneficiary_id !== undefined) updateData.beneficiary_id = beneficiary_id;
        if (status !== undefined) updateData.status = status;

        const { data, error } = await supabaseAdmin
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
            const verified = await buildVerifiedAttachmentRows(
                supabaseAdmin,
                user.id,
                assetId,
                fileMetadata
            );
            if (!verified.ok) {
                return NextResponse.json(
                    { error: verified.error },
                    { status: verified.status }
                );
            }

            const storageCheck = await canUploadFile(
                supabase,
                user.id,
                verified.totalBytes
            );
            if (!storageCheck.allowed) {
                return storageLimitReachedResponse(supabase, user.id, {
                    limit: storageCheck.limit,
                    current: storageCheck.current,
                });
            }

            const { error: attachError } = await supabaseAdmin
                .from('asset_attachments')
                .insert(verified.rows);

            if (attachError) {
                if (isStorageQuotaDbError(attachError.message)) {
                    return storageLimitReachedResponse(supabase, user.id, {
                        limit: storageCheck.limit,
                        current: storageCheck.current,
                    });
                }
                console.error('Error creating asset attachments:', attachError);
                return NextResponse.json(
                    { error: attachError.message || 'Failed to create attachments' },
                    { status: 500 }
                );
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
