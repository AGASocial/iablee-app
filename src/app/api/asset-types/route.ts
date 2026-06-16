import { NextResponse } from 'next/server';
import { createAuthenticatedRouteClient } from '@/lib/supabase-server';
import { getCachedAssetTypesForPlan, getCachedAssetTypeByKey } from '@/lib/server/asset-types-cache';

export async function GET(request: Request) {
    const { supabase, user } = await createAuthenticatedRouteClient();

    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const key = searchParams.get('key');

    if (key) {
        const data = await getCachedAssetTypeByKey(key);
        if (!data) {
            return NextResponse.json({ error: 'Asset type not found' }, { status: 404 });
        }
        return NextResponse.json(data, {
            headers: {
                'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
            },
        });
    }

    try {
    const { data: subscription } = await supabase
            .from('billing_subscriptions')
            .select('plan_id')
            .eq('user_id', user.id)
            .eq('status', 'active')
            .single();

        const resolvedPlanId = subscription?.plan_id || 'plan_free';
        const data = await getCachedAssetTypesForPlan(resolvedPlanId);

        return NextResponse.json(data, {
            headers: {
                'Cache-Control': 'private, s-maxage=300, stale-while-revalidate=600',
            },
        });
    } catch (error) {
        console.error('Error fetching asset types:', error);
        const data = await getCachedAssetTypesForPlan('plan_free');
        return NextResponse.json(data ?? []);
    }
}
