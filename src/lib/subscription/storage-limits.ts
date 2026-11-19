/**
 * Canonical Premium total storage cap (KAN-168).
 * 5 GB expressed as 5000 MB to match billing_plans.features.max_storage_mb
 * and existing UI formatting (5000 → "5 GB").
 */
export const PREMIUM_TOTAL_STORAGE_MB = 5000;

/** Byte equivalent of {@link PREMIUM_TOTAL_STORAGE_MB} (binary MiB × 5000). */
export const PREMIUM_TOTAL_STORAGE_BYTES =
  PREMIUM_TOTAL_STORAGE_MB * 1024 * 1024;
