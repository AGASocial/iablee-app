#!/usr/bin/env node

/**
 * Setup Stripe products and update database
 * Run: node scripts/setup-stripe-products.js
 */

require('dotenv').config({ path: '.env' });
const { createClient } = require('@supabase/supabase-js');

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!STRIPE_SECRET_KEY) {
  console.error('❌ Error: STRIPE_SECRET_KEY not found in .env file');
  process.exit(1);
}

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Error: Supabase credentials not found in .env file');
  process.exit(1);
}

async function createStripeProduct(name, description) {
  const response = await fetch('https://api.stripe.com/v1/products', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      name,
      description,
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Failed to create product: ${data.error?.message}`);
  }
  return data.id;
}

async function createStripePrice(productId, amount, interval) {
  const response = await fetch('https://api.stripe.com/v1/prices', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      product: productId,
      currency: 'usd',
      unit_amount: amount.toString(),
      'recurring[interval]': interval,
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Failed to create price: ${data.error?.message}`);
  }
  return data.id;
}

async function main() {
  console.log('🚀 Setting up Stripe products for Iablee...\n');

  try {
    // Create Necessary Plan
    console.log('📦 Creating Necessary Plan...');
    const necessaryProductId = await createStripeProduct(
      'Necessary Plan',
      'Essential features for managing your digital legacy'
    );
    const necessaryMonthlyPriceId = await createStripePrice(necessaryProductId, 999, 'month');
    const necessaryYearlyPriceId = await createStripePrice(necessaryProductId, 9999, 'year');
    console.log(`✅ Necessary Monthly: ${necessaryMonthlyPriceId}`);
    console.log(`✅ Necessary Yearly: ${necessaryYearlyPriceId}\n`);

    // Create Premium Plan
    console.log('📦 Creating Premium Plan...');
    const premiumProductId = await createStripeProduct(
      'Premium Plan',
      'Unlimited features with priority support'
    );
    const premiumMonthlyPriceId = await createStripePrice(premiumProductId, 1999, 'month');
    const premiumYearlyPriceId = await createStripePrice(premiumProductId, 19999, 'year');
    console.log(`✅ Premium Monthly: ${premiumMonthlyPriceId}`);
    console.log(`✅ Premium Yearly: ${premiumYearlyPriceId}\n`);

    // Update database
    console.log('🔄 Updating database...');
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    const updates = [
      { id: 'plan_necessary_month', priceId: necessaryMonthlyPriceId },
      { id: 'plan_necessary_year', priceId: necessaryYearlyPriceId },
      { id: 'plan_premium_month', priceId: premiumMonthlyPriceId },
      { id: 'plan_premium_year', priceId: premiumYearlyPriceId },
    ];

    for (const { id, priceId } of updates) {
      const { data: plan, error: fetchError } = await supabase
        .from('billing_plans')
        .select('provider_price_map')
        .eq('id', id)
        .single();

      if (fetchError) {
        console.error(`❌ Error fetching plan ${id}:`, fetchError.message);
        continue;
      }

      const updatedMap = { ...plan.provider_price_map, stripe: priceId };

      const { error: updateError } = await supabase
        .from('billing_plans')
        .update({ provider_price_map: updatedMap })
        .eq('id', id);

      if (updateError) {
        console.error(`❌ Error updating plan ${id}:`, updateError.message);
      } else {
        console.log(`✅ Updated ${id}`);
      }
    }

    console.log('\n🎉 Setup complete! Your Stripe products are ready.');
    console.log('\n📝 Stripe Price IDs:');
    console.log('-----------------------------------');
    console.log(`Necessary Monthly: ${necessaryMonthlyPriceId}`);
    console.log(`Necessary Yearly: ${necessaryYearlyPriceId}`);
    console.log(`Premium Monthly: ${premiumMonthlyPriceId}`);
    console.log(`Premium Yearly: ${premiumYearlyPriceId}`);

  } catch (error) {
    console.error('❌ Setup failed:', error.message);
    process.exit(1);
  }
}

main();
