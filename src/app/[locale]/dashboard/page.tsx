"use client";
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PlusCircle, Shield, Users, Key, Activity } from "lucide-react";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

interface Asset {
  id: string;
  asset_name: string;
  asset_type: string;
  status: string;
  created_at: string;
  user_id: string;
}

interface Beneficiary {
  id: string;
  beneficiary_name: string;
  relationship: string;
  status: string;
  created_at: string;
  user_id: string;
}

// Helper for status badge
function StatusBadge({ status }: { status: string }) {
  const statusStyles: Record<string, string> = {
    active: "bg-green-100 text-green-800",
    pending: "bg-yellow-100 text-yellow-800",
    inactive: "bg-red-100 text-red-800",
  };
  return (
    <span className={`px-3 py-1 rounded-full text-xs font-semibold ${statusStyles[status.toLowerCase()] || "bg-gray-100 text-gray-800"}`}>
      {status}
    </span>
  );
}

export default function DashboardPage() {
  const t = useTranslations();
  const [stats, setStats] = useState({
    totalAssets: 0,
    totalBeneficiaries: 0,
    protectedAssets: 0,
    recentActivity: 0
  });
  const [assets, setAssets] = useState<Asset[]>([]);
  const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchDashboardData() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        // Fetch assets
        const { data: assetsData } = await supabase
          .from('digital_assets')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(5);

        // Fetch beneficiaries
        const { data: beneficiariesData } = await supabase
          .from('beneficiaries')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(5);

        // Update stats
        setStats({
          totalAssets: assetsData?.length || 0,
          totalBeneficiaries: beneficiariesData?.length || 0,
          protectedAssets: assetsData?.filter(a => a.status === 'protected')?.length || 0,
          recentActivity: 0 // You can implement this based on your activity tracking
        });

        setAssets(assetsData || []);
        setBeneficiaries(beneficiariesData || []);
      } catch (error) {
        console.error('Error fetching dashboard data:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchDashboardData();
  }, []);

  return (
    <div className="flex-1 space-y-8 p-8 pt-6">
      <div className="flex items-center justify-between">
        <h2 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white">{t('dashboard')}</h2>
      </div>

      {/* Stats Overview */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {t('totalAssets')}
            </CardTitle>
            <Key className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalAssets}</div>
            <p className="text-xs text-muted-foreground">
              {t('digitalAssetsRegistered')}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {t('protectedAssets')}
            </CardTitle>
            <Shield className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.protectedAssets}</div>
            <p className="text-xs text-muted-foreground">
              {t('assetsWithProtection')}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {t('beneficiariesStat')}
            </CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalBeneficiaries}</div>
            <p className="text-xs text-muted-foreground">
              {t('registeredBeneficiaries')}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {t('recentActivity')}
            </CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.recentActivity}</div>
            <p className="text-xs text-muted-foreground">
              {t('changesLast30Days')}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Main Content Cards */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Digital Assets Card */}
        <Card className="col-span-1">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>{t('yourDigitalAssets')}</CardTitle>
              <CardDescription>{t('overviewDigitalAssets')}</CardDescription>
            </div>
            <Button variant="outline" size="sm" className="flex items-center gap-2">
              <PlusCircle className="h-4 w-4" /> {t('addAsset')}
            </Button>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-6">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
              </div>
            ) : assets.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8">
                <Key className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-center text-sm text-muted-foreground">
                  {t('noAssets')}
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {assets.map((asset) => (
                  <div key={asset.id} className="flex items-center justify-between p-4 border rounded-lg">
                    <div className="flex items-center space-x-4">
                      <div>
                        <p className="font-medium">{asset.asset_name}</p>
                        <p className="text-sm text-muted-foreground">{asset.asset_type}</p>
                      </div>
                    </div>
                    <StatusBadge status={asset.status || 'Active'} />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Beneficiaries Card */}
        <Card className="col-span-1">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>{t('recentBeneficiaries')}</CardTitle>
              <CardDescription>{t('manageBeneficiaries')}</CardDescription>
            </div>
            <Button variant="outline" size="sm" className="flex items-center gap-2">
              <PlusCircle className="h-4 w-4" /> {t('addBeneficiary')}
            </Button>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-6">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
              </div>
            ) : beneficiaries.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8">
                <Users className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-center text-sm text-muted-foreground">
                  {t('noBeneficiaries')}
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {beneficiaries.map((beneficiary) => (
                  <div key={beneficiary.id} className="flex items-center justify-between p-4 border rounded-lg">
                    <div className="flex items-center space-x-4">
                      <div>
                        <p className="font-medium">{beneficiary.beneficiary_name}</p>
                        <p className="text-sm text-muted-foreground">{beneficiary.relationship}</p>
                      </div>
                    </div>
                    <StatusBadge status={beneficiary.status || 'Active'} />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
} 