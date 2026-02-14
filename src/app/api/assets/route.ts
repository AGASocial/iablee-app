import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { Database } from '@/lib/supabase';

export async function GET() {
    const cookieStore = await cookies();
    const supabase = createRouteHandlerClient<Database>({ cookies: async () => cookieStore });

    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data, error } = await supabase
        .from('digital_assets')
        .select('id, asset_name, asset_type, status, email, password, website, valid_until, description, files, custom_fields, beneficiary_id, beneficiary:beneficiary_id(id, full_name), asset_type_details:asset_type(id, name, description, icon)')
        .eq('user_id', user.id)
        .order('asset_name', { ascending: true });

    if (error) {
        console.error('Supabase error fetching digital_assets:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
}
