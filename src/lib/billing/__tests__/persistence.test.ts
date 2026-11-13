/**
 * @jest-environment node
 */
import { persistByProviderId } from '../persistence';

function createChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, jest.Mock> = {};
  const terminal = jest.fn().mockResolvedValue(result);
  chain.select = jest.fn().mockReturnValue(chain);
  chain.eq = jest.fn().mockReturnValue(chain);
  chain.maybeSingle = terminal;
  chain.update = jest.fn().mockReturnValue(chain);
  chain.insert = jest.fn().mockResolvedValue(result);
  return chain;
}

describe('persistByProviderId', () => {
  it('updates when a row with the provider id already exists', async () => {
    const selectChain = createChain({ data: { id: 'inv-1' }, error: null });
    const updateChain = createChain({ data: null, error: null });
    // update().eq() resolves via terminal on maybeSingle path — wire update eq to resolve
    updateChain.eq = jest.fn().mockResolvedValue({ data: null, error: null });

    const from = jest.fn((table: string) => {
      if (table === 'billing_invoices' && from.mock.calls.length === 1) {
        return selectChain;
      }
      return updateChain;
    });

    const supabase = { from } as never;
    const result = await persistByProviderId(
      supabase,
      'billing_invoices',
      'provider_invoice_id',
      'ref_123',
      { status: 'paid', amount_cents: 1000 }
    );

    expect(result).toBe('updated');
    expect(selectChain.eq).toHaveBeenCalledWith('provider_invoice_id', 'ref_123');
    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'paid', amount_cents: 1000, updated_at: expect.any(String) })
    );
    expect(updateChain.eq).toHaveBeenCalledWith('id', 'inv-1');
  });

  it('inserts when no row matches the provider id', async () => {
    const selectChain = createChain({ data: null, error: null });
    const insertResult = { data: null, error: null };
    const insertFn = jest.fn().mockResolvedValue(insertResult);

    const from = jest.fn(() => {
      if (from.mock.calls.length === 1) {
        return selectChain;
      }
      return { insert: insertFn };
    });

    const supabase = { from } as never;
    const result = await persistByProviderId(
      supabase,
      'billing_invoices',
      'provider_invoice_id',
      'ref_new',
      { status: 'paid', user_id: 'user-1' }
    );

    expect(result).toBe('inserted');
    expect(insertFn).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'paid',
        user_id: 'user-1',
        provider_invoice_id: 'ref_new',
      })
    );
  });

  it('throws when select fails', async () => {
    const selectChain = createChain({
      data: null,
      error: { message: 'db down', code: 'XX000' },
    });
    const supabase = { from: jest.fn(() => selectChain) } as never;

    await expect(
      persistByProviderId(
        supabase,
        'billing_subscriptions',
        'provider_subscription_id',
        'sub_1',
        { status: 'active' }
      )
    ).rejects.toEqual(expect.objectContaining({ message: 'db down' }));
  });
});
