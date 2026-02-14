import { NextResponse } from 'next/server';
import { createAuthenticatedRouteClient } from '@/lib/supabase-server';
import { canCreateAsset, canCreateBeneficiary } from '@/lib/subscription/limits';

export async function POST(request: Request) {
    const { supabase, user } = await createAuthenticatedRouteClient();

    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const body = await request.json();
        const { asset, beneficiary, fileUrls, fileMetadata } = body;

        if (!asset || !beneficiary) {
            return NextResponse.json({ error: 'Both asset and beneficiary data are required' }, { status: 400 });
        }

        // Enforce subscription limits
        const [assetLimit, beneficiaryLimit] = await Promise.all([
            canCreateAsset(supabase, user.id),
            canCreateBeneficiary(supabase, user.id),
        ]);

        if (!assetLimit.allowed) {
            return NextResponse.json(
                { error: 'LIMIT_REACHED', message: assetLimit.reason, type: 'asset', limit: assetLimit.limit, current: assetLimit.current },
                { status: 403 }
            );
        }
        if (!beneficiaryLimit.allowed) {
            return NextResponse.json(
                { error: 'LIMIT_REACHED', message: beneficiaryLimit.reason, type: 'beneficiary', limit: beneficiaryLimit.limit, current: beneficiaryLimit.current },
                { status: 403 }
            );
        }

        // Create the asset
        const { data: assetData, error: assetError } = await supabase
            .from('digital_assets')
            .insert({
                user_id: user.id,
                asset_type: asset.assetType,
                asset_name: asset.assetName,
                description: asset.description || null,
                website: asset.website || null,
                valid_until: asset.validUntil || null,
                email: asset.email || null,
                password: asset.password || null,
                files: fileUrls && fileUrls.length > 0 ? fileUrls : null,
                custom_fields: asset.customFields && Object.keys(asset.customFields).length > 0 ? asset.customFields : null,
                status: 'unassigned',
            })
            .select()
            .single();

        if (assetError) {
            console.error('Asset creation error:', assetError);
            return NextResponse.json({ error: assetError.message }, { status: 500 });
        }

        // Create asset_attachments records for uploaded files
        if (fileMetadata && Array.isArray(fileMetadata) && fileMetadata.length > 0) {
            const attachmentRows = fileMetadata.map((fm: { path: string; fileName: string; fileType: string; fileSize: number }) => ({
                asset_id: assetData.id,
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

        // Create the beneficiary
        const { data: beneficiaryData, error: beneficiaryError } = await supabase
            .from('beneficiaries')
            .insert({
                user_id: user.id,
                full_name: beneficiary.fullName,
                email: beneficiary.email || null,
                relationship_id: beneficiary.relationshipId || null,
                phone_number: beneficiary.phoneNumber || null,
                notes: beneficiary.notes || null,
                status: 'active',
            })
            .select()
            .single();

        if (beneficiaryError) {
            console.error('Beneficiary creation error:', beneficiaryError);
            return NextResponse.json({ error: beneficiaryError.message }, { status: 500 });
        }

        // Link beneficiary to asset
        const { error: linkError } = await supabase
            .from('digital_assets')
            .update({ beneficiary_id: beneficiaryData.id, status: 'assigned' })
            .eq('id', assetData.id);

        if (linkError) {
            console.error('Link error:', linkError);
            return NextResponse.json({ error: linkError.message }, { status: 500 });
        }

        return NextResponse.json({
            asset: assetData,
            beneficiary: beneficiaryData,
        }, { status: 201 });
    } catch {
        return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
}
