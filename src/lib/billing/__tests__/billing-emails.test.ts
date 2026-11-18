/**
 * @jest-environment node
 */
import {
  sendBillingEmailOnce,
  resolveBillingEmailLocale,
  type BillingEmailSender,
} from '../billing-emails';

describe('resolveBillingEmailLocale', () => {
  it('defaults to ES for Wompi/Colombia when unset', () => {
    expect(resolveBillingEmailLocale(null)).toBe('es');
    expect(resolveBillingEmailLocale(undefined)).toBe('es');
  });

  it('respects en/es', () => {
    expect(resolveBillingEmailLocale('en')).toBe('en');
    expect(resolveBillingEmailLocale('es')).toBe('es');
  });
});

describe('sendBillingEmailOnce', () => {
  it('skips send when idempotency row already exists', async () => {
    const sender: BillingEmailSender = {
      send: jest.fn(async () => ({ sent: true })),
    };
    const supabase = {
      from: () => ({
        insert: () => ({
          select: () => ({
            maybeSingle: async () => ({
              data: null,
              error: { code: '23505', message: 'duplicate key' },
            }),
          }),
        }),
      }),
    };

    const result = await sendBillingEmailOnce(
      supabase as never,
      sender,
      'upcoming_renewal',
      {
        userId: 'u1',
        email: 'a@b.com',
        periodKey: '20261118:upcoming',
      }
    );

    expect(result.skipped).toBe(true);
    expect(sender.send).not.toHaveBeenCalled();
  });

  it('sends when claim succeeds', async () => {
    const sender: BillingEmailSender = {
      send: jest.fn(async () => ({ sent: true })),
    };
    const supabase = {
      from: () => ({
        insert: () => ({
          select: () => ({
            maybeSingle: async () => ({
              data: { id: 'evt-1' },
              error: null,
            }),
          }),
        }),
        delete: () => ({
          eq: async () => ({ error: null }),
        }),
      }),
    };

    const result = await sendBillingEmailOnce(
      supabase as never,
      sender,
      'renewal_success',
      {
        userId: 'u1',
        email: 'a@b.com',
        periodKey: '20261118:renewal_success',
        planName: 'Premium',
        locale: 'es',
      }
    );

    expect(result.sent).toBe(true);
    expect(sender.send).toHaveBeenCalled();
  });

  it('deletes claim on send failure so retries work', async () => {
    const deleted: string[] = [];
    const sender: BillingEmailSender = {
      send: jest.fn(async () => ({ sent: false, error: 'smtp down' })),
    };
    const supabase = {
      from: () => ({
        insert: () => ({
          select: () => ({
            maybeSingle: async () => ({
              data: { id: 'evt-fail' },
              error: null,
            }),
          }),
        }),
        delete: () => ({
          eq: (_col: string, id: string) => {
            deleted.push(id);
            return Promise.resolve({ error: null });
          },
        }),
      }),
    };

    const result = await sendBillingEmailOnce(
      supabase as never,
      sender,
      'payment_failed',
      {
        userId: 'u1',
        email: 'a@b.com',
        periodKey: '20261118:fail:1',
      }
    );

    expect(result.sent).toBe(false);
    expect(deleted).toEqual(['evt-fail']);
  });

  it('deletes claim when sender throws', async () => {
    const deleted: string[] = [];
    const sender: BillingEmailSender = {
      send: jest.fn(async () => {
        throw new Error('boom');
      }),
    };
    const supabase = {
      from: () => ({
        insert: () => ({
          select: () => ({
            maybeSingle: async () => ({
              data: { id: 'evt-throw' },
              error: null,
            }),
          }),
        }),
        delete: () => ({
          eq: (_col: string, id: string) => {
            deleted.push(id);
            return Promise.resolve({ error: null });
          },
        }),
      }),
    };

    const result = await sendBillingEmailOnce(
      supabase as never,
      sender,
      'payment_failed',
      {
        userId: 'u1',
        email: 'a@b.com',
        periodKey: '20261118:fail:2',
      }
    );

    expect(result.sent).toBe(false);
    expect(result.error).toMatch(/boom/);
    expect(deleted).toEqual(['evt-throw']);
  });
});
