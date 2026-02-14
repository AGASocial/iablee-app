import { NextResponse } from 'next/server';
import { createAuthenticatedRouteClient } from '@/lib/supabase-server';

export async function GET(request: Request) {
    const { supabase, user } = await createAuthenticatedRouteClient();

    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const minGenerationLevel = searchParams.get('minGenerationLevel');

    let query = supabase
        .from('relationships')
        .select('id, key, generation_level')
        .order('generation_level, key');

    if (minGenerationLevel) {
        query = query.gte('generation_level', parseInt(minGenerationLevel));
    }

    const { data, error } = await query;

    if (error) {
        console.error('Supabase error fetching relationships:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
}
