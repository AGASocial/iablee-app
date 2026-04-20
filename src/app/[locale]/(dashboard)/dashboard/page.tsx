"use client";
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Shield, Users, Key, Activity, Sparkles } from "lucide-react";
import { useState, useEffect } from "react";

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
        const res = await fetch('/api/dashboard');
        if (!res.ok) return;
        const data = await res.json();

        setStats(data.stats);
        setAssets(data.assets || []);
        setBeneficiaries(data.beneficiaries || []);
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
      const res = await fetch('/api/beneficiaries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: form.full_name,
          email: form.email,
          phone_number: form.phone_number,
          notes: form.notes,
          notified: form.notified,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to add beneficiary');
      }
      setShowAddModal(false);
      setForm({ full_name: '', email: '', phone_number: '', relationship: '', notes: '', notified: false });
      // Refetch dashboard data
      setLoading(true);
      const dashRes = await fetch('/api/dashboard');
      if (dashRes.ok) {
        const data = await dashRes.json();
        setBeneficiaries(data.beneficiaries || []);
      }
    } catch {
      alert('Error adding beneficiary');
    } finally {
      setSubmitting(false);
      setLoading(false);
    }
  }

  return (
    <div className="flex-1 space-y-8 p-4 sm:p-8 pt-6">
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground drop-shadow-[0_1px_1px_rgba(0,0,0,0.18)] dark:text-white sm:text-3xl">
            {t('dashboard') || 'Dashboard'}
          </h2>
          <p className="mt-1 text-sm font-medium text-slate-700 dark:text-slate-200">
            {t('overviewDigitalAssets')}
          </p>
        </div>
      </div>

      {/* Stats Overview */}
      <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-4">
        <Card className="glass-panel hover-lift border-border/50 animate-fade-in-up delay-100">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-foreground">
              {t('totalAssets')}
            </CardTitle>
            <div className="p-2.5 rounded-xl bg-primary/10 shadow-inner">
              <Key className="h-4 w-4 text-primary" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-foreground tracking-tight">{stats.totalAssets}</div>
            <p className="text-xs text-muted-foreground mt-1 font-medium">
              {t('digitalAssetsRegistered')}
            </p>
          </CardContent>
        </Card>
        <Card className="glass-panel hover-lift border-border/50 animate-fade-in-up delay-200">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-foreground">
              {t('protectedAssets')}
            </CardTitle>
            <div className="p-2.5 rounded-xl icon-bg-success shadow-inner">
              <Shield className="h-4 w-4 icon-success" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-foreground tracking-tight">{stats.protectedAssets}</div>
            <p className="text-xs text-muted-foreground mt-1 font-medium">
              {t('assetsWithProtection')}
            </p>
          </CardContent>
        </Card>
        <Card className="glass-panel hover-lift border-border/50 animate-fade-in-up delay-300">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-foreground">
              {t('beneficiariesStat')}
            </CardTitle>
            <div className="p-2.5 rounded-xl icon-bg-accent shadow-inner">
              <Users className="h-4 w-4 icon-accent" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-foreground tracking-tight">{stats.totalBeneficiaries}</div>
            <p className="text-xs text-muted-foreground mt-1 font-medium">
              {t('registeredBeneficiaries')}
            </p>
          </CardContent>
        </Card>
        <Card className="glass-panel hover-lift border-border/50 animate-fade-in-up delay-[400ms]">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-foreground">
              {t('recentActivity')}
            </CardTitle>
            <div className="p-2.5 rounded-xl icon-bg-info shadow-inner">
              <Activity className="h-4 w-4 icon-info" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-foreground tracking-tight">{stats.recentActivity}</div>
            <p className="text-xs text-muted-foreground mt-1 font-medium">
              {t('changesLast30Days')}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Main Content Cards */}
      <div className="grid gap-6 grid-cols-1 md:grid-cols-2 animate-fade-in-up delay-[500ms]">
        {/* Digital Assets Card */}
        <Card className="col-span-1 glass-card border border-border/60 bg-card/90 shadow-xl dark:bg-card/90 dark:shadow-black/40">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 border-b border-border/50 pb-4">
            <div>
              <CardTitle className="text-xl text-foreground dark:text-slate-100">{t('yourDigitalAssets')}</CardTitle>
              <CardDescription className="text-base text-muted-foreground dark:text-slate-300">{t('overviewDigitalAssets')}</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="pt-6">
            {loading ? (
              <div className="flex items-center justify-center py-6">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
              </div>
            ) : assets.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8">
                <div className="h-16 w-16 rounded-full bg-muted/30 flex items-center justify-center mb-4">
                  <Key className="h-8 w-8 text-muted-foreground" />
                </div>
                <p className="text-center text-sm text-muted-foreground mb-4 max-w-[250px]">
                  {t('noAssets')}
                </p>
                <Link href="/wizard">
                  <Button className="btn-primary-gradient flex items-center gap-2 text-primary-foreground shadow-lg shadow-primary/25 hover:shadow-primary/40 transition-all">
                    <Sparkles className="h-4 w-4" />
                    {t('setupWizard')}
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                {assets.map((asset) => (
                  <div key={asset.id} className="group flex items-center justify-between rounded-xl border border-border/40 bg-background/70 p-4 transition-all hover:scale-[1.01] hover:border-primary/25 hover:bg-background/85 hover:shadow-lg dark:bg-background/65 dark:hover:bg-background/80">
                    <div className="flex items-center space-x-4">
                      <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-white transition-colors">
                        <Key className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="font-semibold text-foreground group-hover:text-primary transition-colors">{asset.asset_name}</p>
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
        <Card className="col-span-1 glass-card border border-border/60 bg-card/90 shadow-xl dark:bg-card/90 dark:shadow-black/40">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 border-b border-border/50 pb-4">
            <div>
              <CardTitle className="text-xl text-foreground dark:text-slate-100">{t('recentBeneficiaries')}</CardTitle>
              <CardDescription className="text-base text-muted-foreground dark:text-slate-300">{t('manageBeneficiaries')}</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="pt-6">
            {loading ? (
              <div className="flex items-center justify-center py-6">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
              </div>
            ) : beneficiaries.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8">
                <div className="h-16 w-16 rounded-full bg-muted/30 flex items-center justify-center mb-4">
                  <Users className="h-8 w-8 text-muted-foreground" />
                </div>
                <p className="text-center text-sm text-muted-foreground max-w-[250px]">
                  {t('noBeneficiaries')}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {beneficiaries.map((beneficiary) => (
                  <div key={beneficiary.id} className="group flex flex-col rounded-xl border border-border/40 bg-background/70 p-4 transition-all hover:scale-[1.01] hover:border-primary/25 hover:bg-background/85 hover:shadow-lg dark:bg-background/65 dark:hover:bg-background/80 md:flex-row md:items-center md:justify-between">
                    <div className="flex flex-col space-y-1">
                      <span className="font-semibold text-foreground group-hover:text-primary transition-colors">{beneficiary.full_name}</span>
                      <span className="text-sm text-muted-foreground">{beneficiary.email}</span>
                      {/* Truncate less important info for cleaner look if needed, keeping mostly same for now */}
                      <div className="flex gap-2 flex-wrap mt-2">
                        <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full font-bold ${beneficiary.notified ? 'bg-green-500/10 text-green-500' : 'bg-muted text-muted-foreground'}`}>
                          {beneficiary.notified ? t('notified') : t('notNotified')}
                        </span>
                      </div>
                    </div>
                    <div className="mt-3 md:mt-0">
                      <StatusBadge status={beneficiary.status || 'Active'} />
                    </div>
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