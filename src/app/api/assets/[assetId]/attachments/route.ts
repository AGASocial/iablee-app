
import { NextResponse } from 'next/server';
import { createAuthenticatedRouteClient } from '@/lib/supabase-server';

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

    const { data, error } = await supabase
        .from('asset_attachments')
        .insert({
            asset_id: assetId,
            file_path,
            file_name,
            file_type,
            file_size
        })
        .select()
        .single();

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
}
