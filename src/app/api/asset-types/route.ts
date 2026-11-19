import { NextResponse } from 'next/server';
import { createAuthenticatedRouteClient } from '@/lib/supabase-server';
import { getCachedAssetTypesForPlan, getCachedAssetTypeByKey } from '@/lib/server/asset-types-cache';
import { subscriptionGrantsPaidEntitlement } from '@/lib/billing/dunning';

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
        const { data: subscriptions } = await supabase
            .from('billing_subscriptions')
            .select('plan_id, status, provider, current_period_end, cancel_at_period_end')
            .eq('user_id', user.id)
            .in('status', ['active', 'past_due', 'trialing', 'canceled', 'cancelled'])
            .order('updated_at', { ascending: false })
            .limit(5);

        let resolvedPlanId = 'plan_free';
        for (const sub of subscriptions || []) {
            if (
                subscriptionGrantsPaidEntitlement({
                    status: sub.status as string,
                    provider: sub.provider as string | null,
                    currentPeriodEnd: sub.current_period_end as string | null,
                    cancelAtPeriodEnd: sub.cancel_at_period_end as boolean | null,
                })
            ) {
                resolvedPlanId = (sub.plan_id as string) || 'plan_free';
                break;
            }
        }

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
