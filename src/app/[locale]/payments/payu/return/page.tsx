'use client';

import { useMemo, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';

const statusMessages: Record<string, string> = {
  APPROVED: 'Your payment was approved. We are activating your subscription.',
  DECLINED: 'Your payment was declined. Please try again or use a different method.',
  PENDING: 'Your payment is pending. We will email you once it is confirmed.',
};

function PayUReturnContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const status = useMemo(() => {
    const state =
      searchParams.get('state') ||
        searchParams.get('state_pol') ||
        searchParams.get('transactionState') === '4' ? 'APPROVED' : // 4 is approved in PayU
        searchParams.get('transactionState') === '6' ? 'DECLINED' : // 6 is declined
          searchParams.get('transactionState') === '7' ? 'PENDING' : // 7 is pending
            '';

    // If we have explicit APPROVED text, use it
    if (searchParams.get('lapTransactionState') === 'APPROVED') return 'APPROVED';
    if (searchParams.get('lapTransactionState') === 'DECLINED') return 'DECLINED';
    if (searchParams.get('lapTransactionState') === 'PENDING') return 'PENDING';

    return state.toUpperCase();
  }, [searchParams]);

  const reference =
    searchParams.get('referenceCode') ||
    searchParams.get('reference_sale') ||
    '';

  const message = statusMessages[status] || 'Processing your payment info...';

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 text-center space-y-4">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Payment Status</h1>
        <p className="text-muted-foreground">{message}</p>
      </div>

      {reference && (
        <div className="rounded-md border px-6 py-3 text-sm">
          <p className="font-medium">Reference Code</p>
          <p className="text-muted-foreground">{reference}</p>
        </div>
      )}

      <Button onClick={() => router.push('/billing')}>Return to Billing</Button>
    </div>
  );
}

export default function PayUReturnPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <PayUReturnContent />
    </Suspense>
  );
}
