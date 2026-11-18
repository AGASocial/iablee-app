'use client';

/**
 * Wompi card form — tokenizes in the browser (PAN/CVC never hit our server).
 * Nequi: extension point (paymentType prop reserved); card-only for KAN-166.
 */

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface AcceptancePayload {
  publicKey: string;
  environment: 'sandbox' | 'production';
  acceptanceToken: string;
  acceptancePermalink: string;
  personalAuthToken: string;
  personalAuthPermalink: string;
}

interface TokenMeta {
  brand?: string;
  lastFour?: string;
  expMonth?: number;
  expYear?: number;
}

export interface WompiCardFormProps {
  mode: 'subscribe' | 'replace';
  planId?: string;
  onSuccess?: (result: unknown) => void;
  onCancel?: () => void;
}

function wompiApiBase(env: string): string {
  return env === 'production'
    ? 'https://production.wompi.co/v1'
    : 'https://sandbox.wompi.co/v1';
}

async function tokenizeCard(
  apiBase: string,
  publicKey: string,
  card: {
    number: string;
    cvc: string;
    expMonth: string;
    expYear: string;
    holder: string;
  }
): Promise<{ token: string; meta: TokenMeta }> {
  const response = await fetch(`${apiBase}/tokens/cards`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${publicKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      number: card.number.replace(/\s+/g, ''),
      cvc: card.cvc,
      exp_month: card.expMonth.padStart(2, '0'),
      exp_year: card.expYear.length === 4 ? card.expYear.slice(-2) : card.expYear,
      card_holder: card.holder,
    }),
  });

  const body = await response.json();
  if (!response.ok || !body?.data?.id) {
    throw new Error(body?.error?.reason || 'Card tokenization failed');
  }

  return {
    token: body.data.id as string,
    meta: {
      brand: body.data.brand,
      lastFour: body.data.last_four,
      expMonth: Number(body.data.exp_month),
      expYear: Number(
        String(body.data.exp_year).length === 2
          ? `20${body.data.exp_year}`
          : body.data.exp_year
      ),
    },
  };
}

export default function WompiCardForm({
  mode,
  planId,
  onSuccess,
  onCancel,
}: WompiCardFormProps) {
  const t = useTranslations();
  const locale = useLocale();
  const [acceptance, setAcceptance] = useState<AcceptancePayload | null>(null);
  const [loadingAcceptance, setLoadingAcceptance] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [acceptPersonal, setAcceptPersonal] = useState(false);
  const [holder, setHolder] = useState('');
  const [number, setNumber] = useState('');
  const [expMonth, setExpMonth] = useState('');
  const [expYear, setExpYear] = useState('');
  const [cvc, setCvc] = useState('');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/billing/wompi/acceptance', {
          credentials: 'include',
        });
        if (!res.ok) throw new Error('Failed to load acceptance');
        const data = await res.json();
        if (!cancelled) setAcceptance(data);
      } catch (err) {
        if (!cancelled) {
          console.error(err);
          toast.error(t('billingError'));
        }
      } finally {
        if (!cancelled) setLoadingAcceptance(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [t]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!acceptance) return;
    if (!acceptTerms || !acceptPersonal) {
      toast.error(t('wompiAcceptRequired'));
      return;
    }
    if (mode === 'subscribe' && !planId) {
      toast.error(t('billingError'));
      return;
    }

    setSubmitting(true);
    try {
      const { token, meta } = await tokenizeCard(
        wompiApiBase(acceptance.environment),
        acceptance.publicKey,
        { number, cvc, expMonth, expYear, holder }
      );

      const endpoint =
        mode === 'subscribe'
          ? '/api/billing/wompi/subscribe'
          : '/api/billing/wompi/payment-sources';

      const payload =
        mode === 'subscribe'
          ? {
              planId,
              paymentToken: token,
              paymentType: 'CARD',
              acceptanceToken: acceptance.acceptanceToken,
              acceptPersonalAuth: acceptance.personalAuthToken,
              brand: meta.brand,
              lastFour: meta.lastFour,
              expMonth: meta.expMonth,
              expYear: meta.expYear,
              locale,
            }
          : {
              paymentToken: token,
              paymentType: 'CARD',
              acceptanceToken: acceptance.acceptanceToken,
              acceptPersonalAuth: acceptance.personalAuthToken,
              brand: meta.brand,
              lastFour: meta.lastFour,
              expMonth: meta.expMonth,
              expYear: meta.expYear,
            };

      const res = await fetch(endpoint, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || t('billingError'));
      }

      if (mode === 'subscribe') {
        if (data.transactionStatus === 'APPROVED') {
          toast.success(t('wompiPaymentApproved'));
        } else if (data.transactionStatus === 'PENDING') {
          toast.info(t('wompiPaymentPending'));
        } else {
          toast.error(t('wompiPaymentDeclined'));
        }
      } else {
        toast.success(t('paymentMethodUpdatedSuccess'));
      }

      onSuccess?.(data);
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : t('billingError'));
    } finally {
      setSubmitting(false);
    }
  };

  if (loadingAcceptance) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!acceptance) {
    return <p className="text-sm text-muted-foreground">{t('billingError')}</p>;
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="wompi-holder">{t('wompiCardHolder')}</Label>
        <Input
          id="wompi-holder"
          value={holder}
          onChange={e => setHolder(e.target.value)}
          required
          autoComplete="cc-name"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="wompi-number">{t('wompiCardNumber')}</Label>
        <Input
          id="wompi-number"
          value={number}
          onChange={e => setNumber(e.target.value)}
          required
          inputMode="numeric"
          autoComplete="cc-number"
          placeholder="4242 4242 4242 4242"
        />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-2">
          <Label htmlFor="wompi-exp-m">{t('wompiExpMonth')}</Label>
          <Input
            id="wompi-exp-m"
            value={expMonth}
            onChange={e => setExpMonth(e.target.value)}
            required
            maxLength={2}
            placeholder="08"
            autoComplete="cc-exp-month"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="wompi-exp-y">{t('wompiExpYear')}</Label>
          <Input
            id="wompi-exp-y"
            value={expYear}
            onChange={e => setExpYear(e.target.value)}
            required
            maxLength={4}
            placeholder="28"
            autoComplete="cc-exp-year"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="wompi-cvc">{t('wompiCvc')}</Label>
          <Input
            id="wompi-cvc"
            value={cvc}
            onChange={e => setCvc(e.target.value)}
            required
            maxLength={4}
            autoComplete="cc-csc"
          />
        </div>
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={acceptTerms}
          onChange={e => setAcceptTerms(e.target.checked)}
        />
        <span>
          {t('wompiAcceptTerms')}{' '}
          <a
            href={acceptance.acceptancePermalink}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            {t('wompiViewTerms')}
          </a>
        </span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={acceptPersonal}
          onChange={e => setAcceptPersonal(e.target.checked)}
        />
        <span>
          {t('wompiAcceptPersonal')}{' '}
          <a
            href={acceptance.personalAuthPermalink}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            {t('wompiViewPersonalAuth')}
          </a>
        </span>
      </label>

      <p className="text-xs text-muted-foreground">{t('wompiNequiComingSoon')}</p>

      <div className="flex gap-2 pt-2">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
            {t('cancel')}
          </Button>
        )}
        <Button type="submit" disabled={submitting || !acceptTerms || !acceptPersonal}>
          {submitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t('processing')}
            </>
          ) : mode === 'subscribe' ? (
            t('subscribe')
          ) : (
            t('savePaymentMethod')
          )}
        </Button>
      </div>
    </form>
  );
}
