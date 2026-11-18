/**
 * @jest-environment node
 */
import { sendBillingEmailOnce, type BillingEmailSender } from '../billing-emails';

describe('sendBillingEmailOnce', () => {
  it('skips send when idempotency row already exists', async () => {
    const sender: BillingEmailSender = {
      send: jest.fn(async () => ({ sent: true })),
    };
    const supabase = {
      from: () => ({
        insert: async () => ({
          error: { code: '23505', message: 'duplicate key' },
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

  it('sends when claim succeeds and never throws', async () => {
    const sender: BillingEmailSender = {
      send: jest.fn(async () => ({ sent: true })),
    };
    const supabase = {
      from: () => ({
        insert: async () => ({ error: null }),
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
    expect(sender.send).toHaveBeenCalledWith(
      'renewal_success',
      expect.objectContaining({ locale: 'es' })
    );
  });

  it('swallows sender failures', async () => {
    const sender: BillingEmailSender = {
      send: jest.fn(async () => {
        throw new Error('boom');
      }),
    };
    const supabase = {
      from: () => ({
        insert: async () => ({ error: null }),
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
    expect(result.error).toMatch(/boom/);
  });
});
