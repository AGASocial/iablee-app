'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';

interface PlanFeatures {
  max_assets: number;
  max_beneficiaries: number;
  max_file_size_mb: number;
  max_storage_mb: number;
  priority_support: boolean;
  advanced_security: boolean;
}

interface Plan {
  id: string;
  name: string;
  currency: string;
  amountCents: number;
  interval: 'month' | 'year';
  features: PlanFeatures;
}

export default function PlansPage() {
  const t = useTranslations();
  const router = useRouter();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [billingCycle, setBillingCycle] = useState<'month' | 'year'>('month');
  const [subscribing, setSubscribing] = useState<string | null>(null);

  useEffect(() => {
    fetchPlans();
  }, []);

  const fetchPlans = async () => {
    try {
      const response = await fetch('/api/billing/plans', {
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Failed to fetch plans');
      const data = await response.json();
      setPlans(data.plans);
    } catch (error) {
      console.error('Error fetching plans:', error);
      toast.error(t('errorLoadingPlans'));
    } finally {
      setLoading(false);
    }
  };

  const handleSubscribe = async (planId: string) => {
    setSubscribing(planId);
    try {
      // For now, just navigate to billing dashboard
      // In production, this would integrate with Stripe Checkout or Elements
      router.push('/billing');
      toast.success(t('subscriptionUpdatedSuccess'));
    } catch (error) {
      console.error('Error subscribing:', error);
      toast.error(t('billingError'));
    } finally {
      setSubscribing(null);
    }
  };

  const formatPrice = (amountCents: number, currency: string) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency,
      minimumFractionDigits: 2,
    }).format(amountCents / 100);
  };

  const formatFeatureValue = (key: string, value: number | boolean) => {
    if (typeof value === 'boolean') {
      return value ? t('yes') : t('no');
    }
    if (value === -1) {
      return t('unlimited');
    }
    if (key.includes('storage') || key.includes('file_size')) {
      return `${value} MB`;
    }
    return value.toString();
  };

  const filteredPlans = plans.filter(plan => plan.interval === billingCycle);

  if (loading) {
    return (
      <div className="container mx-auto py-10">
        <div className="text-center">{t('loadingPlans')}</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-10">
      <div className="text-center mb-10">
        <h1 className="text-4xl font-bold mb-4 text-black dark:text-white">{t('pricing')}</h1>
        <p className="text-muted-foreground mb-8">
          {t('choosePlan')}
        </p>

        {/* Billing Cycle Toggle */}
        <div className="inline-flex items-center gap-4 p-1 bg-muted rounded-lg">
          <button
            onClick={() => setBillingCycle('month')}
            className={`px-6 py-2 rounded-md transition-colors ${
              billingCycle === 'month'
                ? 'bg-background shadow-sm'
                : 'hover:bg-background/50'
            }`}
          >
            {t('monthly')}
          </button>
          <button
            onClick={() => setBillingCycle('year')}
            className={`px-6 py-2 rounded-md transition-colors ${
              billingCycle === 'year'
                ? 'bg-background shadow-sm'
                : 'hover:bg-background/50'
            }`}
          >
            {t('yearly')}
            <span className="ml-2 text-xs text-green-600 font-semibold">
              {t('saveWithYearly')}
            </span>
          </button>
        </div>
      </div>

      {/* Plan Cards */}
      <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
        {filteredPlans.map((plan) => {
          const isPremium = plan.name === 'Premium';
          const isFree = plan.amountCents === 0;

          return (
            <Card
              key={plan.id}
              className={`relative ${
                isPremium ? 'border-primary shadow-lg scale-105' : ''
              }`}
            >
              {isPremium && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground px-4 py-1 rounded-full text-sm font-semibold">
                  {t('popular')}
                </div>
              )}

              <CardHeader>
                <CardTitle className="text-2xl">{plan.name}</CardTitle>
                <CardDescription>
                  <div className="mt-4">
                    <span className="text-4xl font-bold text-foreground">
                      {formatPrice(plan.amountCents, plan.currency)}
                    </span>
                    <span className="text-muted-foreground">
                      {' / '}
                      {plan.interval === 'month' ? t('perMonth') : t('perYear')}
                    </span>
                  </div>
                  <div className="text-xs mt-2">
                    {plan.interval === 'month' ? t('billedMonthly') : t('billedYearly')}
                  </div>
                </CardDescription>
              </CardHeader>

              <CardContent>
                <ul className="space-y-3">
                  <li className="flex items-center gap-2">
                    <Check className="h-5 w-5 text-primary flex-shrink-0" />
                    <span>
                      {formatFeatureValue('max_assets', plan.features.max_assets)}{' '}
                      {t('maxAssets')}
                    </span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-5 w-5 text-primary flex-shrink-0" />
                    <span>
                      {formatFeatureValue('max_beneficiaries', plan.features.max_beneficiaries)}{' '}
                      {t('maxBeneficiaries')}
                    </span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-5 w-5 text-primary flex-shrink-0" />
                    <span>
                      {formatFeatureValue('max_file_size', plan.features.max_file_size_mb)}{' '}
                      {t('maxFileSize')}
                    </span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-5 w-5 text-primary flex-shrink-0" />
                    <span>
                      {formatFeatureValue('max_storage', plan.features.max_storage_mb)}{' '}
                      {t('maxStorage')}
                    </span>
                  </li>
                  {plan.features.advanced_security && (
                    <li className="flex items-center gap-2">
                      <Check className="h-5 w-5 text-primary flex-shrink-0" />
                      <span>{t('advancedSecurity')}</span>
                    </li>
                  )}
                  {plan.features.priority_support && (
                    <li className="flex items-center gap-2">
                      <Check className="h-5 w-5 text-primary flex-shrink-0" />
                      <span>{t('prioritySupport')}</span>
                    </li>
                  )}
                </ul>
              </CardContent>

              <CardFooter>
                <Button
                  className="w-full"
                  variant={isPremium ? 'default' : 'outline'}
                  disabled={subscribing === plan.id || isFree}
                  onClick={() => handleSubscribe(plan.id)}
                >
                  {subscribing === plan.id
                    ? t('loading')
                    : isFree
                    ? t('currentPlan')
                    : t('subscribe')}
                </Button>
              </CardFooter>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
