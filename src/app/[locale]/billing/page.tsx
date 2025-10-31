'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { FileText, Calendar, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { format } from 'date-fns';
import PaymentMethodsList from '@/components/billing/PaymentMethodsList';

interface PlanFeatures {
  max_assets: number;
  max_beneficiaries: number;
  max_storage_mb: number;
  priority_support: boolean;
}

interface Subscription {
  id: string;
  planId: string;
  status: string;
  currentPeriodEnd?: Date;
  cancelAtPeriodEnd: boolean;
  plan: {
    name: string;
    amountCents: number;
    currency: string;
    interval: string;
    features: PlanFeatures;
  };
}

interface Invoice {
  id: string;
  amountCents: number;
  currency: string;
  status: string;
  issuedAt: Date;
  paidAt?: Date;
}

export default function BillingPage() {
  const t = useTranslations();
  const router = useRouter();
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [canceling, setCanceling] = useState(false);

  useEffect(() => {
    fetchBillingData();
  }, []);

  const fetchBillingData = async () => {
    try {
      const [subResponse, invoicesResponse] = await Promise.all([
        fetch('/api/billing/subscriptions', { credentials: 'include' }),
        fetch('/api/billing/invoices', { credentials: 'include' }),
      ]);

      if (subResponse.ok) {
        const subData = await subResponse.json();
        setSubscription(subData.subscription);
      }

      if (invoicesResponse.ok) {
        const invoicesData = await invoicesResponse.json();
        setInvoices(invoicesData.invoices);
      }
    } catch (error) {
      console.error('Error fetching billing data:', error);
      toast.error(t('errorLoadingSubscription'));
    } finally {
      setLoading(false);
    }
  };

  const handleCancelSubscription = async () => {
    if (!subscription) return;

    if (!confirm(t('confirmCancelSubscription'))) return;

    setCanceling(true);
    try {
      const response = await fetch(
        `/api/billing/subscriptions?subscriptionId=${subscription.id}&atPeriodEnd=true`,
        {
          method: 'DELETE',
          credentials: 'include'
        }
      );

      if (!response.ok) throw new Error('Failed to cancel subscription');

      toast.success(t('subscriptionCanceledSuccess'));
      fetchBillingData();
    } catch (error) {
      console.error('Error canceling subscription:', error);
      toast.error(t('billingError'));
    } finally {
      setCanceling(false);
    }
  };

  const handleResumeSubscription = async () => {
    if (!subscription) return;

    try {
      const response = await fetch('/api/billing/subscriptions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          subscriptionId: subscription.id,
          cancelAtPeriodEnd: false,
        }),
      });

      if (!response.ok) throw new Error('Failed to resume subscription');

      toast.success(t('subscriptionResumedSuccess'));
      fetchBillingData();
    } catch (error) {
      console.error('Error resuming subscription:', error);
      toast.error(t('billingError'));
    }
  };

  const formatPrice = (amountCents: number, currency: string) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency,
    }).format(amountCents / 100);
  };

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'active':
        return 'text-green-600';
      case 'past_due':
        return 'text-yellow-600';
      case 'canceled':
        return 'text-red-600';
      default:
        return 'text-gray-600';
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto py-10">
        <div className="text-center">{t('loadingSubscription')}</div>
      </div>
    );
  }

  if (!subscription) {
    return (
      <div className="container mx-auto py-10">
        <Card>
          <CardHeader>
            <CardTitle>{t('subscription')}</CardTitle>
            <CardDescription>{t('noSubscription')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => router.push('/billing/plans')}>
              {t('choosePlan')}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-10 space-y-8">
      <div>
        <h1 className="text-3xl font-bold mb-2">{t('billingDashboard')}</h1>
        <p className="text-muted-foreground">{t('manageBilling')}</p>
      </div>

      {/* Subscription Details */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>{t('subscriptionDetails')}</span>
            <span className={`text-sm font-normal ${getStatusColor(subscription.status)}`}>
              {t(`subscription${subscription.status.charAt(0).toUpperCase() + subscription.status.slice(1)}`)}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <h3 className="font-semibold mb-2">{t('currentPlan')}</h3>
              <p className="text-2xl font-bold">{subscription.plan.name}</p>
              <p className="text-muted-foreground">
                {formatPrice(subscription.plan.amountCents, subscription.plan.currency)} / {subscription.plan.interval === 'month' ? t('perMonth') : t('perYear')}
              </p>
            </div>

            <div>
              <h3 className="font-semibold mb-2 flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                {subscription.cancelAtPeriodEnd ? t('willCancelOn') : t('renewalDate')}
              </h3>
              <p className="text-lg">
                {subscription.currentPeriodEnd
                  ? format(new Date(subscription.currentPeriodEnd), 'PPP')
                  : '-'}
              </p>
            </div>
          </div>

          {subscription.cancelAtPeriodEnd && (
            <div className="flex items-center gap-2 p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
              <AlertCircle className="h-5 w-5 text-yellow-600" />
              <p className="text-sm">{t('cancelSubscriptionDescription')}</p>
            </div>
          )}

          <div className="flex gap-4">
            {!subscription.cancelAtPeriodEnd ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => router.push('/billing/plans')}
                >
                  {t('upgradePlan')}
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleCancelSubscription}
                  disabled={canceling}
                >
                  {canceling ? t('loading') : t('cancelSubscription')}
                </Button>
              </>
            ) : (
              <Button onClick={handleResumeSubscription}>
                {t('resumeSubscription')}
              </Button>
            )}
          </div>

          {/* Plan Features */}
          <div>
            <h3 className="font-semibold mb-3">{t('planFeatures')}</h3>
            <div className="grid md:grid-cols-2 gap-3 text-sm">
              <div className="flex justify-between p-2 bg-muted rounded">
                <span>{t('maxAssets')}</span>
                <span className="font-semibold">
                  {subscription.plan.features.max_assets === -1
                    ? t('unlimited')
                    : subscription.plan.features.max_assets}
                </span>
              </div>
              <div className="flex justify-between p-2 bg-muted rounded">
                <span>{t('maxBeneficiaries')}</span>
                <span className="font-semibold">
                  {subscription.plan.features.max_beneficiaries === -1
                    ? t('unlimited')
                    : subscription.plan.features.max_beneficiaries}
                </span>
              </div>
              <div className="flex justify-between p-2 bg-muted rounded">
                <span>{t('maxStorage')}</span>
                <span className="font-semibold">
                  {subscription.plan.features.max_storage_mb} MB
                </span>
              </div>
              <div className="flex justify-between p-2 bg-muted rounded">
                <span>{t('prioritySupport')}</span>
                <span className="font-semibold">
                  {subscription.plan.features.priority_support ? '✓' : '—'}
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Payment Methods */}
      <PaymentMethodsList />

      {/* Billing History */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            {t('billingHistory')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {invoices.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">{t('noInvoices')}</p>
          ) : (
            <div className="space-y-4">
              {invoices.map((invoice) => (
                <div
                  key={invoice.id}
                  className="flex items-center justify-between p-4 border rounded-lg"
                >
                  <div className="flex items-center gap-4">
                    <FileText className="h-8 w-8 text-muted-foreground" />
                    <div>
                      <p className="font-semibold">
                        {formatPrice(invoice.amountCents, invoice.currency)}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {format(new Date(invoice.issuedAt), 'PPP')}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <span
                      className={`text-sm font-semibold ${
                        invoice.status === 'paid' ? 'text-green-600' : 'text-yellow-600'
                      }`}
                    >
                      {t(`invoice${invoice.status.charAt(0).toUpperCase() + invoice.status.slice(1)}`)}
                    </span>
                    {invoice.status === 'paid' && (
                      <Button variant="ghost" size="sm">
                        {t('downloadInvoice')}
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
