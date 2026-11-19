/**
 * Canonical Premium total storage cap (KAN-168).
 *
 * Product copy shows this as **"5 GB"** (decimal-style label via
 * `formatStorage`: 5000 % 1000 === 0 → "5 GB"). Enforcement uses binary MiB:
 * `max_storage_mb * 1024 * 1024` bytes = **5000 × 1,048,576 = 5,242,880,000
 * bytes (≈ 4.88 decimal GB / exactly 5000 MiB)**.
 *
 * Keep `PREMIUM_TOTAL_STORAGE_MB = 5000` to match
 * `billing_plans.features.max_storage_mb` and UI; do not switch to 5120
 * without a coordinated product/legal copy change.
 */
export const PREMIUM_TOTAL_STORAGE_MB = 5000;

/** Byte equivalent of {@link PREMIUM_TOTAL_STORAGE_MB}: MB × 1024 × 1024 (MiB math). */
export const PREMIUM_TOTAL_STORAGE_BYTES =
  PREMIUM_TOTAL_STORAGE_MB * 1024 * 1024;
