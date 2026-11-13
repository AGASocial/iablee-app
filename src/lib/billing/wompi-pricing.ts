/**
 * PLACEHOLDER COP amount-in-cents for Wompi checkout.
 *
 * Plans are stored in USD in billing_plans.amount_cents. Wompi only charges COP.
 * Do NOT treat USD cents as COP cents.
 *
 * TODO(Gabriel): Confirm official COP prices before go-live and update both
 * this map and the migration that sets provider_price_map.wompi.
 */

/** Copied into supabase migration provider_price_map.wompi as numeric strings. */
export const WOMPI_PLACEHOLDER_COP_CENTS: Readonly<Record<string, number>> = {
  plan_necessary_month: 40_000_00, // PLACEHOLDER: 40,000.00 COP
  plan_necessary_year: 400_000_00, // PLACEHOLDER: 400,000.00 COP
  plan_premium_month: 80_000_00, // PLACEHOLDER: 80,000.00 COP
  plan_premium_year: 800_000_00, // PLACEHOLDER: 800,000.00 COP
};

/**
 * Resolve COP amount-in-cents for a plan.
 * Priority:
 * 1) Numeric string in plan.providerPriceMap.wompi (e.g. "4000000")
 * 2) WOMPI_PLACEHOLDER_COP_CENTS[planId]
 */
export function resolveWompiAmountInCents(
  planId: string,
  providerPriceMapWompi?: string | null
): number {
  if (providerPriceMapWompi != null && providerPriceMapWompi !== '') {
    const trimmed = providerPriceMapWompi.trim();
    if (/^\d+$/.test(trimmed)) {
      const parsed = Number.parseInt(trimmed, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
      throw new Error(
        `Invalid Wompi COP amount in provider_price_map.wompi for plan ${planId}: must be a positive integer (amount-in-cents)`
      );
    }
    // Non-numeric legacy placeholders (e.g. "necessary_monthly") fall through to config
  }

  const fromConfig = WOMPI_PLACEHOLDER_COP_CENTS[planId];
  if (fromConfig != null && fromConfig > 0) {
    return fromConfig;
  }

  throw new Error(
    `Missing Wompi COP pricing for plan ${planId}. Set a positive amount-in-cents in provider_price_map.wompi or wompi-pricing.ts (PLACEHOLDER — confirm official COP prices before go-live).`
  );
}
