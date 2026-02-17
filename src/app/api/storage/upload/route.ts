import { NextResponse } from 'next/server';
import { createAuthenticatedRouteClient } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase-admin';

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

        // Sanitize file name
        const safeFileName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
        const filePath = `${user.id}/${Date.now()}-${safeFileName}`;

        const { data, error } = await supabaseAdmin.storage
            .from('assets')
            .upload(filePath, file);

        if (error) {
            console.error('Storage upload error:', error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({
            path: data.path,
            fileName: safeFileName, // Return the sanitized name for the DB record
            originalName: file.name, // Keep original if needed for UI, but primary name is now safe
            fileType: file.type,
            fileSize: file.size,
        }, { status: 201 });
    } catch {
        return NextResponse.json({ error: 'Failed to process upload' }, { status: 400 });
    }
}
