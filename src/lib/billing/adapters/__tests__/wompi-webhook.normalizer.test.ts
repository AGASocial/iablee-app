import crypto from 'crypto';
import {
  WompiWebhookNormalizer,
  buildWompiEventChecksum,
  getWompiPropertyValue,
} from '../wompi-webhook.normalizer';

const EVENTS_SECRET = 'prod_events_OcHnIzeBl5socpwByQ4hA52Em3USQ93Z';

const OFFICIAL_CONCAT =
  '1234-1610641025-49201APPROVED44900001530291411prod_events_OcHnIzeBl5socpwByQ4hA52Em3USQ93Z';

/**
 * Wompi docs publish digest 3476DDA5... for this concat, but standard SHA256
 * of the published concat string is the value below (verified with OpenSSL/Node).
 */
const OFFICIAL_CONCAT_SHA256 = crypto
  .createHash('sha256')
  .update(OFFICIAL_CONCAT)
  .digest('hex');

function buildApprovedEvent(overrides?: {
  properties?: string[];
  status?: string;
  reference?: string;
  checksum?: string;
  secretForChecksum?: string;
}) {
  const properties =
    overrides?.properties || [
      'transaction.id',
      'transaction.status',
      'transaction.amount_in_cents',
    ];
  const status = overrides?.status || 'APPROVED';
  const reference =
    overrides?.reference ||
    'wompi_48508890-08ea-40bc-8dc6-4a0860f6bc6a_plan_necessary_month_1769218748365';

  const data = {
    transaction: {
      id: '1234-1610641025-49201',
      status,
      amount_in_cents: 4490000,
      reference,
      currency: 'COP',
      customer_email: 'john.doe@example.com',
    },
  };

  const timestamp = 1530291411;
  const checksum =
    overrides?.checksum ||
    buildWompiEventChecksum({
      data,
      properties,
      timestamp,
      eventsSecret: overrides?.secretForChecksum || EVENTS_SECRET,
    });

  return {
    event: 'transaction.updated',
    data,
    sent_at: '2018-07-20T16:45:05.000Z',
    timestamp,
    signature: {
      properties,
      checksum,
    },
  };
}

describe('buildWompiEventChecksum', () => {
  it('matches SHA256 of the official property concat + timestamp + secret', () => {
    const checksum = buildWompiEventChecksum({
      data: {
        transaction: {
          id: '1234-1610641025-49201',
          status: 'APPROVED',
          amount_in_cents: 4490000,
        },
      },
      properties: [
        'transaction.id',
        'transaction.status',
        'transaction.amount_in_cents',
      ],
      timestamp: 1530291411,
      eventsSecret: EVENTS_SECRET,
    });

    expect(checksum).toBe(OFFICIAL_CONCAT_SHA256);
    // Documented digest in Wompi docs does not match standard SHA256 of their concat.
    expect(checksum.toUpperCase()).not.toBe(
      '3476DDA50F64CD7CBD160689640506FEBEA93239BC524FC0469B2C68A3CC8BD0'
    );
  });

  it('respects dynamic signature.properties order', () => {
    const data = {
      transaction: {
        id: '1234-1610641025-49201',
        status: 'APPROVED',
        amount_in_cents: 4490000,
      },
    };

    const orderA = buildWompiEventChecksum({
      data,
      properties: [
        'transaction.id',
        'transaction.status',
        'transaction.amount_in_cents',
      ],
      timestamp: 1530291411,
      eventsSecret: EVENTS_SECRET,
    });

    const orderB = buildWompiEventChecksum({
      data,
      properties: [
        'transaction.status',
        'transaction.id',
        'transaction.amount_in_cents',
      ],
      timestamp: 1530291411,
      eventsSecret: EVENTS_SECRET,
    });

    expect(orderA).not.toBe(orderB);
  });

  it('throws when a listed property is missing', () => {
    expect(() =>
      getWompiPropertyValue({ transaction: { id: '1' } }, 'transaction.status')
    ).toThrow(/Missing Wompi signature property/);
  });
});

describe('WompiWebhookNormalizer.verify', () => {
  const normalizer = new WompiWebhookNormalizer({ eventsSecret: EVENTS_SECRET });

  it('accepts a valid checksum from the body', async () => {
    const event = buildApprovedEvent();
    const result = await normalizer.verify(event, {});
    expect(result.verified).toBe(true);
  });

  it('accepts X-Event-Checksum header (case-insensitive compare)', async () => {
    const event = buildApprovedEvent();
    const result = await normalizer.verify(
      { ...event, signature: { ...event.signature, checksum: 'deadbeef' } },
      { 'X-Event-Checksum': event.signature.checksum.toUpperCase() }
    );
    expect(result.verified).toBe(true);
  });

  it('rejects a tampered payload', async () => {
    const event = buildApprovedEvent();
    event.data.transaction.amount_in_cents = 1;
    const result = await normalizer.verify(event, {});
    expect(result.verified).toBe(false);
    expect(result.error).toMatch(/checksum/i);
  });

  it('rejects the wrong events secret', async () => {
    const event = buildApprovedEvent({ secretForChecksum: 'wrong_secret' });
    const result = await normalizer.verify(event, {});
    expect(result.verified).toBe(false);
  });

  it('rejects when signature.properties paths are missing', async () => {
    const event = buildApprovedEvent();
    event.signature.properties = ['transaction.id', 'transaction.missing_field'];
    event.signature.checksum = '00'.repeat(32);
    const result = await normalizer.verify(event, {});
    expect(result.verified).toBe(false);
    expect(result.error).toMatch(/Missing Wompi signature property/);
  });
});

describe('WompiWebhookNormalizer.normalize', () => {
  const normalizer = new WompiWebhookNormalizer({ eventsSecret: EVENTS_SECRET });

  it('maps APPROVED to invoice.paid with reference userId/planId', () => {
    const event = buildApprovedEvent();
    const normalized = normalizer.normalize(event);

    expect(normalized).toMatchObject({
      id: '1234-1610641025-49201-APPROVED',
      type: 'invoice.paid',
      provider: 'wompi',
      data: {
        invoiceId: event.data.transaction.reference,
        subscriptionId: event.data.transaction.reference,
        amountCents: 4490000,
        currency: 'COP',
        status: 'paid',
        userId: '48508890-08ea-40bc-8dc6-4a0860f6bc6a',
        planId: 'plan_necessary_month',
      },
    });
  });

  it.each([
    ['DECLINED', 'invoice.payment_failed'],
    ['VOIDED', 'invoice.payment_failed'],
    ['ERROR', 'invoice.payment_failed'],
  ] as const)('maps %s to %s', (status, type) => {
    const event = buildApprovedEvent({ status });
    const normalized = normalizer.normalize(event);
    expect(normalized?.type).toBe(type);
    expect(normalized?.id).toBe(`1234-1610641025-49201-${status}`);
  });

  it('maps PENDING to subscription.updated incomplete', () => {
    const event = buildApprovedEvent({ status: 'PENDING' });
    const normalized = normalizer.normalize(event);

    expect(normalized).toMatchObject({
      type: 'subscription.updated',
      data: {
        status: 'incomplete',
        subscriptionId: event.data.transaction.reference,
        userId: '48508890-08ea-40bc-8dc6-4a0860f6bc6a',
        planId: 'plan_necessary_month',
      },
    });
  });

  it('returns null for unsupported event types', () => {
    const event = buildApprovedEvent();
    event.event = 'nequi_token.updated';
    expect(normalizer.normalize(event)).toBeNull();
    expect(normalizer.shouldProcess('nequi_token.updated')).toBe(false);
  });
});
