import { NextResponse } from 'next/server';
import { createAuthenticatedRouteClient } from '@/lib/supabase-server';

export async function GET(request: Request) {
    const { supabase, user } = await createAuthenticatedRouteClient();

    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const key = searchParams.get('key');

    // Single asset type lookup by key
    if (key) {
        const { data, error } = await supabase
            .from('asset_types')
            .select('*')
            .eq('key', key)
            .eq('is_active', true)
            .single();

        if (error) {
            console.error('Supabase error fetching asset type:', error);
            return NextResponse.json({ error: error.message }, { status: 404 });
        }

        return NextResponse.json(data);
    }

    // Get asset types available for the user's plan
    try {
        // Get the user's active subscription
        const { data: subscription } = await supabase
            .from('billing_subscriptions')
            .select('plan_id')
            .eq('user_id', user.id)
            .eq('status', 'active')
            .single();

        const planId = subscription?.plan_id || 'plan_free';

        // Get asset type IDs for this plan
        const { data: junctionData, error: junctionError } = await supabase
            .from('asset_type_billing_plans')
            .select('asset_type_id')
            .eq('billing_plan_id', planId);

        if (junctionError) {
            console.error('Error fetching asset type IDs for plan:', junctionError);
            return NextResponse.json({ error: junctionError.message }, { status: 500 });
        }

        if (!junctionData || junctionData.length === 0) {
            return NextResponse.json([]);
        }

        const assetTypeIds = junctionData.map(item => item.asset_type_id);
        const { data, error } = await supabase
            .from('asset_types')
            .select('*')
            .in('id', assetTypeIds)
            .eq('is_active', true)
            .order('display_order', { ascending: true });

        if (error) {
            console.error('Supabase error fetching asset types:', error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json(data);
    } catch {
        // Fallback: return free plan asset types
        const { data: junctionData } = await supabase
            .from('asset_type_billing_plans')
            .select('asset_type_id')
            .eq('billing_plan_id', 'plan_free');

        if (!junctionData || junctionData.length === 0) {
            return NextResponse.json([]);
        }

        const assetTypeIds = junctionData.map(item => item.asset_type_id);
        const { data } = await supabase
            .from('asset_types')
            .select('*')
            .in('id', assetTypeIds)
            .eq('is_active', true)
            .order('display_order', { ascending: true });

        return NextResponse.json(data || []);
    }
}
