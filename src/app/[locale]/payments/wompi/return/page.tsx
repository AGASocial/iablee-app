'use client';

import { useEffect, useMemo, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';

const statusMessages: Record<string, string> = {
  APPROVED: 'Your payment was approved. We are activating your subscription.',
  DECLINED: 'Your payment was declined. Please try again or use a different method.',
  VOIDED: 'Your payment was voided. Please try again or contact support.',
  ERROR: 'There was an error processing your payment. Please try again.',
  PENDING: 'Your payment is pending. We will email you once it is confirmed.',
};

function WompiReturnContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const transactionId = searchParams.get('id') || '';

  const [lookupStatus, setLookupStatus] = useState<string>('');
  const [reference, setReference] = useState('');
  const [lookupError, setLookupError] = useState(false);

  useEffect(() => {
    if (!transactionId) return;

    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch(
          `/api/payments/wompi/transaction?id=${encodeURIComponent(transactionId)}`,
          { credentials: 'include' }
        );
        if (!response.ok) {
          if (!cancelled) setLookupError(true);
          return;
        }
        const data = (await response.json()) as {
          status?: string;
          reference?: string;
        };
        if (cancelled) return;
        setLookupStatus((data.status || '').toUpperCase());
        setReference(data.reference || '');
      } catch {
        if (!cancelled) setLookupError(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [transactionId]);

  const message = useMemo(() => {
    if (lookupStatus && statusMessages[lookupStatus]) {
      return statusMessages[lookupStatus];
    }
    if (lookupError) {
      return 'We received your payment redirect. Final confirmation comes from Wompi events — check Billing shortly.';
    }
    if (transactionId) {
      return 'Looking up your payment status...';
    }
    return 'Processing your payment info...';
  }, [lookupStatus, lookupError, transactionId]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 text-center space-y-4">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Payment Status</h1>
        <p className="text-muted-foreground">{message}</p>
        <p className="text-xs text-muted-foreground">
          This page is informational only. Your plan activates when Wompi confirms the payment via webhook.
        </p>
      </div>

      {(reference || transactionId) && (
        <div className="rounded-md border px-6 py-3 text-sm space-y-2">
          {reference && (
            <div>
              <p className="font-medium">Reference</p>
              <p className="text-muted-foreground break-all">{reference}</p>
            </div>
          )}
          {transactionId && (
            <div>
              <p className="font-medium">Transaction ID</p>
              <p className="text-muted-foreground break-all">{transactionId}</p>
            </div>
          )}
          {lookupStatus && (
            <div>
              <p className="font-medium">Status</p>
              <p className="text-muted-foreground">{lookupStatus}</p>
            </div>
          )}
        </div>
      )}

      <Button onClick={() => router.push('/billing')}>Return to Billing</Button>
    </div>
  );
}

export default function WompiReturnPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <WompiReturnContent />
    </Suspense>
  );
}
