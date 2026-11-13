import {
  resolveWompiAmountInCents,
  WOMPI_PLACEHOLDER_COP_CENTS,
} from '../wompi-pricing';

describe('resolveWompiAmountInCents', () => {
  it('uses placeholder config when provider map is a non-numeric legacy id', () => {
    expect(resolveWompiAmountInCents('plan_necessary_month', 'necessary_monthly')).toBe(
      WOMPI_PLACEHOLDER_COP_CENTS.plan_necessary_month
    );
  });

  it('prefers numeric provider_price_map.wompi', () => {
    expect(resolveWompiAmountInCents('plan_necessary_month', '5550000')).toBe(5550000);
  });

  it('throws for zero or invalid numeric strings', () => {
    expect(() => resolveWompiAmountInCents('plan_necessary_month', '0')).toThrow(
      /positive integer/
    );
  });

  it('throws when no pricing is available', () => {
    expect(() => resolveWompiAmountInCents('plan_unknown', 'not-a-number')).toThrow(
      /Missing Wompi COP pricing/
    );
  });

  it('keeps paid-plan placeholders positive for sandbox checkout', () => {
    for (const [planId, amount] of Object.entries(WOMPI_PLACEHOLDER_COP_CENTS)) {
      expect(amount).toBeGreaterThan(0);
      expect(resolveWompiAmountInCents(planId)).toBe(amount);
    }
  });
});
