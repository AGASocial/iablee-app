'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import type { Subscription, PlanDefinition, CheckoutSessionDetails } from '@/lib/billing/types';

const PAYMENT_GATEWAY = process.env.NEXT_PUBLIC_PAYMENT_GATEWAY || 'payu';

interface PlanFeatures {
  max_assets: number;
  max_beneficiaries: number;
  max_file_size_mb: number;
  max_storage_mb: number;
  max_video_assets?: number;
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
  providerPriceMap?: Partial<Record<string, string>>;
}

interface SubscriptionWithPlan extends Subscription {
  plan?: PlanDefinition;
}

export default function PlansPage() {
  const t = useTranslations();
  const router = useRouter();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [billingCycle, setBillingCycle] = useState<'month' | 'year'>('month');
  const [subscribing, setSubscribing] = useState<string | null>(null);
  const [currentSubscription, setCurrentSubscription] = useState<SubscriptionWithPlan | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const [plansResponse, subResponse] = await Promise.all([
          fetch('/api/billing/plans', { credentials: 'include' }),
          fetch('/api/billing/subscriptions', { credentials: 'include' }),
        ]);

        if (cancelled) return;

        if (subResponse.ok) {
          const subData = await subResponse.json();
          if (!cancelled) setCurrentSubscription(subData.subscription);
        }

        if (!plansResponse.ok) throw new Error('Failed to fetch plans');
        const plansData = await plansResponse.json();
        if (!cancelled) setPlans(plansData.plans);
      } catch (error) {
        if (cancelled) return;
        console.error('Error fetching plans:', error);
        toast.error(t('errorLoadingPlans'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [t]);

  const handleSubscribe = async (planId: string) => {
    setSubscribing(planId);
    try {
      const plan = plans.find(p => p.id === planId);

      // Free plan - users are already on it by default
      if (plan?.amountCents === 0) {
        toast.info(t('alreadyOnFreePlan'));
        router.push('/billing');
        return;
      }

      const isHostedCheckout =
        PAYMENT_GATEWAY === 'payu' || PAYMENT_GATEWAY === 'wompi';

      if (!isHostedCheckout) {
        // Check if user has a payment method
        const pmResponse = await fetch('/api/billing/payment-methods', {
          credentials: 'include'
        });

        if (!pmResponse.ok) {
          toast.error(t('billingError'));
          return;
        }

        const { paymentMethods } = await pmResponse.json();

        if (!paymentMethods || paymentMethods.length === 0) {
          toast.error(t('addPaymentMethodFirst'));
          router.push('/billing');
          return;
        }
      }

      // Check if user has existing subscription (not Free plan)
      const hasExistingSubscription = currentSubscription &&
                                      currentSubscription.planId !== 'plan_free' &&
                                      currentSubscription.id !== 'free';

      // Hosted gateways (PayU / Wompi) renew and change plans via a new Web Checkout
      // (POST), not Stripe-oriented PATCH/updateSubscription.
      let response;
      if (hasExistingSubscription && !isHostedCheckout) {
        response = await fetch('/api/billing/subscriptions', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            subscriptionId: currentSubscription.id,
            planId
          }),
        });
      } else {
        response = await fetch('/api/billing/subscriptions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ planId }),
        });
      }

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || 'Failed to create subscription');
      }

      if (
        (PAYMENT_GATEWAY === 'payu' || PAYMENT_GATEWAY === 'wompi') &&
        result.checkoutSession
      ) {
        startHostedCheckout(result.checkoutSession);
        return;
      }

      toast.success(hasExistingSubscription ? t('subscriptionUpdatedSuccess') : t('subscriptionCreatedSuccess'));
      router.push('/billing');
    } catch (error) {
      console.error('Error subscribing:', error);
      toast.error(error instanceof Error ? error.message : t('billingError'));
    } finally {
      setSubscribing(null);
    }
  };

  const startHostedCheckout = (session: CheckoutSessionDetails) => {
    if (!session.formFields || !session.url) {
      toast.error(t('billingError'));
      return;
    }

    const form = document.createElement('form');
    form.method = session.formMethod || 'POST';
    form.action = session.url;
    form.style.display = 'none';

    Object.entries(session.formFields).forEach(([key, value]) => {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = key;
      input.value = value;
      form.appendChild(input);
    });

    document.body.appendChild(form);
    form.submit();
  };

  const formatPrice = (plan: Plan) => {
    // Production gateway is Wompi (COP). Display COP from provider_price_map.wompi
    // — same source as checkout. Do not treat USD amountCents as COP cents.
    if (PAYMENT_GATEWAY === 'wompi') {
      const wompiRaw = plan.providerPriceMap?.wompi;
      if (wompiRaw && /^\d+$/.test(wompiRaw.trim())) {
        const copCents = Number.parseInt(wompiRaw.trim(), 10);
        const copPesos = copCents / 100;
        return new Intl.NumberFormat('es-CO', {
          style: 'currency',
          currency: 'COP',
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        }).format(copPesos);
      }
      if (plan.amountCents === 0) {
        return new Intl.NumberFormat('es-CO', {
          style: 'currency',
          currency: 'COP',
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        }).format(0);
      }
    }

    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: plan.currency || 'USD',
      minimumFractionDigits: 2,
    }).format(plan.amountCents / 100);
  };

  const formatFeatureValue = (key: string, value: number | boolean) => {
    if (typeof value === 'boolean') {
      return value ? t('yes') : t('no');
    }
    if (value === -1) {
      return t('unlimited');
    }
    if (key.includes('storage')) {
      if (typeof value === 'number' && value >= 1000 && value % 1000 === 0) {
        return `${value / 1000} GB`;
      }
      return `${value} MB`;
    }
    if (key.includes('file_size')) {
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
      <div className="page-header mb-10 text-center">
        <h1 className="page-title mb-4 text-4xl font-bold">{t('pricing')}</h1>
        <p className="page-subtitle mb-8">
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
            <span className="ml-2 text-xs text-success font-semibold">
              {t('saveWithYearly')}
            </span>
          </button>
        </div>
      </div>

      {/* Plan Cards — Free + Premium only (Necessary hidden via is_visible) */}
      <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto px-4 justify-center items-center">
        {filteredPlans.map((plan) => {
          const isPremium = plan.name === 'Premium';
          const isCurrentPlan = currentSubscription?.planId === plan.id;
          const displayName =
            plan.name === 'Free'
              ? t('freePlan')
              : plan.name === 'Premium'
                ? t('premiumPlan')
                : plan.name;

          return (
            <Card
              key={plan.id}
              data-selected-option={isPremium ? "true" : undefined}
              className={`relative ${
                isPremium ? 'border-selected-option-border bg-selected-option-bg shadow-lg' : ''
              }`}
            >
              {isPremium && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-success text-success-foreground px-4 py-1 rounded-full text-sm font-semibold">
                  {t('popular')}
                </div>
              )}

              <CardHeader>
                <CardTitle className="text-2xl">{displayName}</CardTitle>
                <CardDescription>
                  <div className="mt-4">
                    <span className="text-4xl font-bold text-foreground">
                      {formatPrice(plan)}
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

              <CardContent className="min-h-[300px]">
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
                  {typeof plan.features.max_video_assets === 'number' &&
                    plan.features.max_video_assets > 0 && (
                    <li className="flex items-center gap-2">
                      <Check className="h-5 w-5 text-primary flex-shrink-0" />
                      <span>
                        {formatFeatureValue('max_video_assets', plan.features.max_video_assets)}{' '}
                        {t('maxVideoAssets')}
                      </span>
                    </li>
                  )}
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
                  disabled={subscribing === plan.id || isCurrentPlan}
                  onClick={() => handleSubscribe(plan.id)}
                >
                  {subscribing === plan.id
                    ? t('loading')
                    : isCurrentPlan
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
