"use client";
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Shield, Users, Key, Activity, Sparkles } from "lucide-react";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import type { Asset } from '@/models/asset';
import type { Beneficiary } from '@/models/beneficiary';
import { Link } from '@/i18n/navigation';


// Helper for status badge
function StatusBadge({ status }: { status: string }) {
  const statusClassMap: Record<string, string> = {
    active: "badge-active",
    pending: "badge-pending",
    inactive: "badge-inactive",
    protected: "badge-protected",
  };
  return (
    <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${statusClassMap[status.toLowerCase()] || "bg-muted text-muted-foreground border-border"}`}>
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
  const [showAddModal, setShowAddModal] = useState(false);
  const [form, setForm] = useState({
    full_name: '',
    email: '',
    phone_number: '',
    relationship: '',
    notes: '',
    notified: false,
  });
  const [submitting, setSubmitting] = useState(false);

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
          .order('asset_name', { ascending: true })
          .limit(5);

        // Fetch beneficiaries
        const { data: beneficiariesData } = await supabase
          .from('beneficiaries')
          .select('*')
          .eq('user_id', user.id)
          .order('full_name', { ascending: false })
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

  // Add beneficiary handler
  async function handleAddBeneficiary() {
    setSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No user');
      console.log('User:', user);
      const { error } = await supabase.from('beneficiaries').insert({
        user_id: user.id,
        full_name: form.full_name,
        email: form.email,
        phone_number: form.phone_number,
        relationship: form.relationship,
        notes: form.notes,
        notified: form.notified,
        status: 'active',
      });
      if (error) throw error;
      setShowAddModal(false);
      setForm({ full_name: '', email: '', phone_number: '', relationship: '', notes: '', notified: false });
      setLoading(true);
      // Refetch data
      const { data: beneficiariesData } = await supabase
        .from('beneficiaries')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(5);
      setBeneficiaries(beneficiariesData || []);
    } catch {
      alert('Error adding beneficiary');
    } finally {
      setSubmitting(false);
      setLoading(false);
    }
  }

  return (
    <div className="flex-1 space-y-8 p-4 sm:p-8 pt-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
            {t('dashboard')}
          </h2>
          <p className="text-sm text-muted-foreground mt-1">{t('overviewDigitalAssets')}</p>
        </div>
      </div>

      {/* Stats Overview */}
      <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-4">
        <Card className="card-gradient hover-lift border-border/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-foreground">
              {t('totalAssets')}
            </CardTitle>
            <div className="p-2 rounded-lg bg-primary/10">
              <Key className="h-4 w-4 text-primary" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">{stats.totalAssets}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {t('digitalAssetsRegistered')}
            </p>
          </CardContent>
        </Card>
        <Card className="card-gradient hover-lift border-border/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-foreground">
              {t('protectedAssets')}
            </CardTitle>
            <div className="p-2 rounded-lg icon-bg-success">
              <Shield className="h-4 w-4 icon-success" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">{stats.protectedAssets}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {t('assetsWithProtection')}
            </p>
          </CardContent>
        </Card>
        <Card className="card-gradient hover-lift border-border/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-foreground">
              {t('beneficiariesStat')}
            </CardTitle>
            <div className="p-2 rounded-lg icon-bg-accent">
              <Users className="h-4 w-4 icon-accent" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">{stats.totalBeneficiaries}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {t('registeredBeneficiaries')}
            </p>
          </CardContent>
        </Card>
        <Card className="card-gradient hover-lift border-border/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-foreground">
              {t('recentActivity')}
            </CardTitle>
            <div className="p-2 rounded-lg icon-bg-info">
              <Activity className="h-4 w-4 icon-info" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">{stats.recentActivity}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {t('changesLast30Days')}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Main Content Cards */}
      <div className="grid gap-6 grid-cols-1 md:grid-cols-2">
        {/* Digital Assets Card */}
        <Card className="col-span-1 card-gradient hover-lift border-border/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>{t('yourDigitalAssets')}</CardTitle>
              <CardDescription>{t('overviewDigitalAssets')}</CardDescription>
            </div>
            {/* <Button variant="outline" size="sm" className="flex items-center gap-2">
              <PlusCircle className="h-4 w-4" /> {t('addAsset')}
            </Button> */}
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-6">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
              </div>
            ) : assets.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8">
                <Key className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-center text-sm text-muted-foreground mb-4">
                  {t('noAssets')}
                </p>
                <Link href="/wizard">
                  <Button className="btn-primary-gradient flex items-center gap-2 text-primary-foreground">
                    <Sparkles className="h-4 w-4" />
                    {t('setupWizard')}
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                {assets.map((asset) => (
                  <div key={asset.id} className="flex items-center justify-between p-4 border rounded-lg bg-card/50 hover:bg-accent/30 transition-colors hover-lift">
                    <div className="flex items-center space-x-4">
                      <div>
                        <p className="font-medium text-foreground">{asset.asset_name}</p>
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
        <Card className="col-span-1 card-gradient hover-lift border-border/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>{t('recentBeneficiaries')}</CardTitle>
              <CardDescription>{t('manageBeneficiaries')}</CardDescription>
            </div>
            {/* <Button variant="outline" size="sm" className="flex items-center gap-2" onClick={() => setShowAddModal(true)}>
              <PlusCircle className="h-4 w-4" /> {t('addBeneficiary')}
            </Button> */}
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
              <div className="space-y-3">
                {beneficiaries.map((beneficiary) => (
                  <div key={beneficiary.id} className="flex flex-col md:flex-row md:items-center md:justify-between p-4 border rounded-lg bg-card/50 hover:bg-accent/30 transition-colors hover-lift">
                    <div className="flex flex-col space-y-1">
                      <span className="font-medium text-foreground">{beneficiary.full_name}</span>
                      <span className="text-sm text-muted-foreground">{beneficiary.email}</span>
                      <span className="text-sm text-muted-foreground">{beneficiary.phone_number}</span>
                      <span className="text-sm text-muted-foreground">{beneficiary.relationship}</span>
                      {beneficiary.notes && <span className="text-sm text-muted-foreground">{beneficiary.notes}</span>}
                      <div className="flex gap-2 flex-wrap mt-1">
                        <span className={`text-xs px-2 py-0.5 rounded ${beneficiary.notified ? 'badge-active' : 'bg-muted text-muted-foreground'}`}>
                          {beneficiary.notified ? t('notified') : t('notNotified')}
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded ${beneficiary.email_verified ? 'badge-active' : 'bg-muted text-muted-foreground'}`}>
                          {beneficiary.email_verified ? t('emailVerified') : t('emailNotVerified')}
                        </span>
                      </div>
                      {beneficiary.last_notified_at && <span className="text-xs text-muted-foreground">{t('lastNotifiedAt')}: {beneficiary.last_notified_at}</span>}
                    </div>
                    <StatusBadge status={beneficiary.status || 'Active'} />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-2">
          <div className="bg-card border border-border rounded-lg shadow-xl p-4 sm:p-8 w-full max-w-md card-gradient">
            <h3 className="text-lg font-bold mb-4">{t('addBeneficiary')}</h3>
            <div className="space-y-4">
              <input className="w-full p-2 border rounded" placeholder={t('name')} value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} />
              <input className="w-full p-2 border rounded" placeholder={t('email')} value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
              <input className="w-full p-2 border rounded" placeholder={t('phoneNumber')} value={form.phone_number} onChange={e => setForm(f => ({ ...f, phone_number: e.target.value }))} />
              <input className="w-full p-2 border rounded" placeholder={t('relationship')} value={form.relationship} onChange={e => setForm(f => ({ ...f, relationship: e.target.value }))} />
              <textarea className="w-full p-2 border rounded" placeholder={t('notes')} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={form.notified} onChange={e => setForm(f => ({ ...f, notified: e.target.checked }))} />
                {t('notifyNow')}
              </label>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <Button variant="outline" onClick={() => setShowAddModal(false)}>{t('cancel')}</Button>
              <Button onClick={handleAddBeneficiary} disabled={submitting}>
                {submitting ? t('saving') : t('save')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
} 