'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { CardElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

interface AddPaymentMethodFormProps {
  onSuccess?: () => void;
  onCancel?: () => void;
}

export default function AddPaymentMethodForm({ onSuccess, onCancel }: AddPaymentMethodFormProps) {
  const t = useTranslations();
  const stripe = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements) {
      toast.error(t('billingError'));
      return;
    }

    setLoading(true);

    try {
      const cardElement = elements.getElement(CardElement);
      if (!cardElement) {
        throw new Error('Card element not found');
      }

      // Create payment method
      const { error, paymentMethod } = await stripe.createPaymentMethod({
        type: 'card',
        card: cardElement,
      });

      if (error) {
        throw new Error(error.message);
      }

      // Attach payment method to customer via API
      const response = await fetch('/api/billing/payment-methods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          paymentMethodId: paymentMethod.id,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to add payment method');
      }

      toast.success(t('paymentMethodAddedSuccess'));
      onSuccess?.();
    } catch (error) {
      console.error('Error adding payment method:', error);
      toast.error(error instanceof Error ? error.message : t('billingError'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="p-4 border rounded-lg bg-background">
        <CardElement
          options={{
            style: {
              base: {
                fontSize: '16px',
                color: '#424770',
                '::placeholder': {
                  color: '#aab7c4',
                },
              },
              invalid: {
                color: '#9e2146',
              },
            },
          }}
        />
      </div>

      <div className="flex gap-4">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>
            {t('cancel')}
          </Button>
        )}
        <Button type="submit" disabled={!stripe || loading} className="flex-1">
          {loading ? t('loading') : t('addPaymentMethod')}
        </Button>
      </div>
    </form>
  );
}
