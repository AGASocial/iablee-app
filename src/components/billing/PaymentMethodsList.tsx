'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { CreditCard, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import StripeProvider from './StripeProvider';
import AddPaymentMethodForm from './AddPaymentMethodForm';

interface PaymentMethod {
  id: string;
  type: string;
  card?: {
    brand: string;
    last4: string;
    expMonth: number;
    expYear: number;
  };
  isDefault: boolean;
}

export default function PaymentMethodsList() {
  const t = useTranslations();
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    fetchPaymentMethods();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchPaymentMethods = async () => {
    try {
      const response = await fetch('/api/billing/payment-methods', {
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Failed to fetch payment methods');

      const data = await response.json();
      setPaymentMethods(data.paymentMethods || []);
    } catch (error) {
      console.error('Error fetching payment methods:', error);
      toast.error(t('billingError'));
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (paymentMethodId: string) => {
    if (!confirm(t('confirmDeletePaymentMethod'))) return;

    setDeleting(paymentMethodId);
    try {
      const response = await fetch(
        `/api/billing/payment-methods?paymentMethodId=${paymentMethodId}`,
        {
          method: 'DELETE',
          credentials: 'include'
        }
      );

      if (!response.ok) throw new Error('Failed to delete payment method');

      toast.success(t('paymentMethodRemovedSuccess'));
      fetchPaymentMethods();
    } catch (error) {
      console.error('Error deleting payment method:', error);
      toast.error(t('billingError'));
    } finally {
      setDeleting(null);
    }
  };

  const handleSetDefault = async (paymentMethodId: string) => {
    try {
      const response = await fetch('/api/billing/payment-methods', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ paymentMethodId }),
      });

      if (!response.ok) throw new Error('Failed to set default payment method');

      toast.success(t('paymentMethodUpdatedSuccess'));
      fetchPaymentMethods();
    } catch (error) {
      console.error('Error setting default payment method:', error);
      toast.error(t('billingError'));
    }
  };

  const handleAddSuccess = () => {
    setShowAddForm(false);
    fetchPaymentMethods();
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            {t('paymentMethods')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-center text-muted-foreground">{t('loading')}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            {t('paymentMethods')}
          </span>
          {!showAddForm && (
            <Button onClick={() => setShowAddForm(true)} size="sm">
              {t('addPaymentMethod')}
            </Button>
          )}
        </CardTitle>
        <CardDescription>{t('managePaymentMethods')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {showAddForm && (
          <div className="p-4 border rounded-lg bg-muted/50">
            <h3 className="font-semibold mb-4">{t('addPaymentMethod')}</h3>
            <StripeProvider>
              <AddPaymentMethodForm
                onSuccess={handleAddSuccess}
                onCancel={() => setShowAddForm(false)}
              />
            </StripeProvider>
          </div>
        )}

        {paymentMethods.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">{t('noPaymentMethods')}</p>
        ) : (
          <div className="space-y-3">
            {paymentMethods.map((pm) => (
              <div
                key={pm.id}
                className="flex items-center justify-between p-4 border rounded-lg"
              >
                <div className="flex items-center gap-4">
                  <CreditCard className="h-8 w-8 text-muted-foreground" />
                  <div>
                    <p className="font-semibold">
                      {pm.card?.brand.toUpperCase()} {t('cardEnding')} {pm.card?.last4}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {t('expires')} {pm.card?.expMonth}/{pm.card?.expYear}
                    </p>
                    {pm.isDefault && (
                      <span className="text-xs bg-primary text-primary-foreground px-2 py-1 rounded">
                        {t('defaultPaymentMethod')}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {!pm.isDefault && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleSetDefault(pm.id)}
                    >
                      {t('setAsDefault')}
                    </Button>
                  )}
                  {!pm.isDefault && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(pm.id)}
                      disabled={deleting === pm.id}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
