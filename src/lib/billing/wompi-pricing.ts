/**
 * Wompi COP amount-in-cents for checkout.
 *
 * Plans are stored in USD in billing_plans.amount_cents. Wompi only charges COP.
 * Do NOT treat USD cents as COP cents.
 *
 * Official Premium prices confirmed 2026-11-17 (KAN-164):
 *   plan_premium_month  9.900 COP  = 990_000 cents
 *   plan_premium_year  99.000 COP  = 9_900_000 cents
 * Keep in sync with migration 20261118000000_kan164_free_premium_visibility.sql.
 *
 * Necessary entries are legacy hidden-plan fallbacks only (not official confirmed
 * product prices). Necessary stays in the DB for existing subscribers but is not
 * offered for new purchases (is_visible=false).
 */

/** Copied into supabase migration provider_price_map.wompi as numeric strings. */
export const WOMPI_PLAN_AMOUNT_COP_CENTS: Readonly<Record<string, number>> = {
  // Legacy Necessary fallbacks (hidden plans; renewals only)
  plan_necessary_month: 4_000_000, // 40,000.00 COP — legacy
  plan_necessary_year: 40_000_000, // 400,000.00 COP — legacy
  // Official Premium (KAN-164)
  plan_premium_month: 990_000, // 9,900.00 COP
  plan_premium_year: 9_900_000, // 99,000.00 COP
};

/**
 * Resolve COP amount-in-cents for a plan.
 * Priority:
 * 1) Numeric string in plan.providerPriceMap.wompi (e.g. "990000")
 * 2) WOMPI_PLAN_AMOUNT_COP_CENTS[planId]
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

  const fromConfig = WOMPI_PLAN_AMOUNT_COP_CENTS[planId];
  if (fromConfig != null && fromConfig > 0) {
    return fromConfig;
  }

  throw new Error(
    `Missing Wompi COP pricing for plan ${planId}. Set a positive amount-in-cents in provider_price_map.wompi or wompi-pricing.ts.`
  );
}
