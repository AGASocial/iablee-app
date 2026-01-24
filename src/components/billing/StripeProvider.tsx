'use client';

import { Elements } from '@stripe/react-stripe-js';
import { loadStripe, Stripe } from '@stripe/stripe-js';
import { useEffect, useState } from 'react';

// Initialize Stripe outside component to avoid recreating on each render
let stripePromise: Promise<Stripe | null> | null = null;

const getStripe = () => {
  if (!stripePromise) {
    const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    if (!publishableKey) {
      console.error('Missing NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY');
      return null;
    }
    stripePromise = loadStripe(publishableKey);
  }
  return stripePromise;
};

interface StripeProviderProps {
  children: React.ReactNode;
  clientSecret?: string;
}

export default function StripeProvider({ children, clientSecret }: StripeProviderProps) {
  const [stripe, setStripe] = useState<Promise<Stripe | null> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stripeInstance = getStripe();
    // Use setTimeout to avoid synchronous setState in effect
    setTimeout(() => {
      if (!stripeInstance) {
        setLoading(false);
        return;
      }
      setStripe(stripeInstance);
      setLoading(false);
    }, 0);
  }, []);

  // Show loading while Stripe is initializing
  if (loading) {
    return <div className="p-4 text-center">Loading payment form...</div>;
  }

  // Show error if Stripe failed to load
  if (!stripe) {
    return (
      <div className="p-4 text-center text-red-600">
        Failed to load payment processor. Please check configuration.
      </div>
    );
  }

  const options = clientSecret ? { clientSecret } : {};

  return (
    <Elements stripe={stripe} options={options}>
      {children}
    </Elements>
  );
}
