import { NextResponse } from 'next/server';
import { createAuthenticatedRouteClient } from '@/lib/supabase-server';
import { withTiming } from '@/lib/observability';

export const GET = withTiming('GET /api/dashboard', async () => {
    const { supabase, user } = await createAuthenticatedRouteClient();

    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const [
            { data: assetsData, error: assetsError },
            { data: beneficiariesData, error: beneficiariesError },
            { count: totalAssets, error: assetsCountError },
            { count: totalBeneficiaries, error: beneficiariesCountError },
            { count: protectedAssets, error: protectedCountError },
        ] = await Promise.all([
            supabase
                .from('digital_assets')
                .select('*')
                .eq('user_id', user.id)
                .order('asset_name', { ascending: true })
                .limit(5),
            supabase
                .from('beneficiaries')
                .select('*')
                .eq('user_id', user.id)
                .order('full_name', { ascending: false })
                .limit(5),
            supabase
                .from('digital_assets')
                .select('*', { count: 'exact', head: true })
                .eq('user_id', user.id),
            supabase
                .from('beneficiaries')
                .select('*', { count: 'exact', head: true })
                .eq('user_id', user.id),
            supabase
                .from('digital_assets')
                .select('*', { count: 'exact', head: true })
                .eq('user_id', user.id)
                .eq('status', 'protected'),
        ]);

        if (assetsError || beneficiariesError || assetsCountError || beneficiariesCountError || protectedCountError) {
            const err = assetsError || beneficiariesError || assetsCountError || beneficiariesCountError || protectedCountError;
            console.error('Supabase error fetching dashboard data:', err);
            return NextResponse.json({ error: err!.message }, { status: 500 });
        }

        const stats = {
            totalAssets: totalAssets ?? 0,
            totalBeneficiaries: totalBeneficiaries ?? 0,
            protectedAssets: protectedAssets ?? 0,
            recentActivity: 0,
        };

        return NextResponse.json({
            assets: assetsData || [],
            beneficiaries: beneficiariesData || [],
            stats,
        });
    } catch {
        return NextResponse.json({ error: 'Failed to fetch dashboard data' }, { status: 500 });
    }
});
