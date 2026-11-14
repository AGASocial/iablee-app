import {
  WompiAdapter,
  buildWompiIntegritySignature,
  buildWompiReference,
  parseWompiReference,
} from '../wompi.adapter';
import type { PlanDefinition } from '../../types';
import { WOMPI_PLAN_AMOUNT_COP_CENTS } from '../../wompi-pricing';

describe('buildWompiIntegritySignature', () => {
  it('matches the official Wompi integrity test vector', () => {
    const hash = buildWompiIntegritySignature({
      reference: 'sk8-438k4-xmxm392-sn2m',
      amountInCents: 2490000,
      currency: 'COP',
      integritySecret: 'prod_integrity_Z5mMke9x0k8gpErbDqwrJXMqsI6SFli6',
    });

    expect(hash).toBe(
      '37c8407747e595535433ef8f6a811d853cd943046624a0ec04662b17bbf33bf5'
    );
  });

  it('includes expiration-time before the integrity secret when provided', () => {
    const withoutExpiry = buildWompiIntegritySignature({
      reference: 'sk8-438k4-xmxm392-sn2m',
      amountInCents: 2490000,
      currency: 'COP',
      integritySecret: 'prod_integrity_Z5mMke9x0k8gpErbDqwrJXMqsI6SFli6',
    });

    const withExpiry = buildWompiIntegritySignature({
      reference: 'sk8-438k4-xmxm392-sn2m',
      amountInCents: 2490000,
      currency: 'COP',
      expirationTime: '2023-06-09T20:28:50.000Z',
      integritySecret: 'prod_integrity_Z5mMke9x0k8gpErbDqwrJXMqsI6SFli6',
    });

    expect(withExpiry).not.toBe(withoutExpiry);
    expect(withExpiry).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('Wompi reference helpers', () => {
  it('builds and parses a round-trip reference', () => {
    const userId = '48508890-08ea-40bc-8dc6-4a0860f6bc6a';
    const planId = 'plan_necessary_month';
    const reference = buildWompiReference(userId, planId, 1769218748365);

    expect(reference).toBe(
      `wompi_${userId}_${planId}_1769218748365`
    );
    expect(parseWompiReference(reference)).toEqual({
      userId,
      planId,
      timestamp: '1769218748365',
    });
  });

  it('returns null for invalid references', () => {
    expect(parseWompiReference('payu_abc_123')).toBeNull();
  });
});

describe('WompiAdapter.createCheckoutSession', () => {
  const adapter = new WompiAdapter({
    environment: 'sandbox',
    publicKey: 'pub_test_example',
    privateKey: 'prv_test_example',
    integritySecret: 'test_integrity_example',
    redirectUrl: 'http://localhost:3000/es/payments/wompi/return',
  });

  const plan: PlanDefinition = {
    id: 'plan_necessary_month',
    name: 'Necessary',
    currency: 'USD',
    amountCents: 999,
    interval: 'month',
    features: {
      max_assets: 50,
      max_beneficiaries: 10,
      max_file_size_mb: 100,
      max_storage_mb: 5000,
      priority_support: false,
      advanced_security: true,
    },
  };

  it('builds GET checkout form fields with COP amount and integrity signature', async () => {
    const userId = '48508890-08ea-40bc-8dc6-4a0860f6bc6a';
    const session = await adapter.createCheckoutSession({
      plan,
      successUrl: 'http://localhost:3000/es/payments/wompi/return',
      cancelUrl: 'http://localhost:3000/es/payments/wompi/return',
      metadata: {
        user_id: userId,
        plan_id: plan.id,
        reference_code: `wompi_${userId}_${plan.id}_111`,
      },
      customerData: {
        email: 'buyer@example.com',
        name: 'Buyer Example',
        userId,
      },
    });

    const expectedAmount = WOMPI_PLAN_AMOUNT_COP_CENTS[plan.id];
    const expectedSignature = buildWompiIntegritySignature({
      reference: `wompi_${userId}_${plan.id}_111`,
      amountInCents: expectedAmount,
      currency: 'COP',
      integritySecret: 'test_integrity_example',
    });

    expect(session.url).toBe('https://checkout.wompi.co/p/');
    expect(session.formMethod).toBe('GET');
    expect(session.formFields).toEqual({
      'public-key': 'pub_test_example',
      currency: 'COP',
      'amount-in-cents': String(expectedAmount),
      reference: `wompi_${userId}_${plan.id}_111`,
      'signature:integrity': expectedSignature,
      'redirect-url': 'http://localhost:3000/es/payments/wompi/return',
      'customer-data:email': 'buyer@example.com',
      'customer-data:full-name': 'Buyer Example',
    });
    // Must not charge USD plan.amountCents as COP
    expect(session.formFields?.['amount-in-cents']).not.toBe('999');
  });

  it('prefers numeric provider_price_map.wompi over config placeholders', async () => {
    const userId = '48508890-08ea-40bc-8dc6-4a0860f6bc6a';
    const session = await adapter.createCheckoutSession({
      plan: {
        ...plan,
        providerPriceMap: { wompi: '1234500' },
      },
      successUrl: '',
      cancelUrl: '',
      metadata: {
        user_id: userId,
        plan_id: plan.id,
        reference_code: `wompi_${userId}_${plan.id}_222`,
      },
    });

    expect(session.formFields?.['amount-in-cents']).toBe('1234500');
  });
});
