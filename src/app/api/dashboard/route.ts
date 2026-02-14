import { NextResponse } from 'next/server';
import { createAuthenticatedRouteClient } from '@/lib/supabase-server';

export async function GET() {
    const { supabase, user } = await createAuthenticatedRouteClient();

    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        // Fetch recent assets (limit 5)
        const { data: assetsData, error: assetsError } = await supabase
            .from('digital_assets')
            .select('*')
            .eq('user_id', user.id)
            .order('asset_name', { ascending: true })
            .limit(5);

        if (assetsError) {
            console.error('Supabase error fetching dashboard assets:', assetsError);
            return NextResponse.json({ error: assetsError.message }, { status: 500 });
        }

        // Fetch recent beneficiaries (limit 5)
        const { data: beneficiariesData, error: beneficiariesError } = await supabase
            .from('beneficiaries')
            .select('*')
            .eq('user_id', user.id)
            .order('full_name', { ascending: false })
            .limit(5);

        if (beneficiariesError) {
            console.error('Supabase error fetching dashboard beneficiaries:', beneficiariesError);
            return NextResponse.json({ error: beneficiariesError.message }, { status: 500 });
        }

        const assets = assetsData || [];
        const beneficiaries = beneficiariesData || [];

        // Compute stats
        const stats = {
            totalAssets: assets.length,
            totalBeneficiaries: beneficiaries.length,
            protectedAssets: assets.filter(a => a.status === 'protected').length,
            recentActivity: 0,
        };

        return NextResponse.json({
            assets,
            beneficiaries,
            stats,
        });
    } catch {
        return NextResponse.json({ error: 'Failed to fetch dashboard data' }, { status: 500 });
    }
}
