/**
 * Wompi transaction reference helpers (KAN-166).
 *
 * Formats:
 * - First charge:  wompi_first_{userId}_{planId}_{subscriptionId}_{attempt}
 * - Legacy first:  wompi_first_{userId}_{planId}_{subscriptionId} (no attempt)
 *                  wompi_first_{userId}_{planId}_{timestamp}
 *                  wompi_{userId}_{planId}_{timestamp}
 * - Renewal:       wompi_renew_{subscriptionId}_{periodEndYmd}_{attempt}
 */

const UUID =
  '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const PLAN = 'plan_[a-z0-9_]+';

/** Sentinel period_end for first-charge rows in billing_renewal_attempts */
export const FIRST_CHARGE_PERIOD_SENTINEL = '1970-01-01T00:00:00.000Z';

const FIRST_WITH_ATTEMPT_PATTERN = new RegExp(
  `^wompi_first_(${UUID})_(${PLAN})_(${UUID})_(\\d+)$`,
  'i'
);
const FIRST_DETERMINISTIC_PATTERN = new RegExp(
  `^wompi_first_(${UUID})_(${PLAN})_(${UUID})$`,
  'i'
);
const FIRST_LEGACY_TS_PATTERN = new RegExp(
  `^wompi_first_(${UUID})_(${PLAN})_(\\d+)$`,
  'i'
);
const LEGACY_PATTERN = new RegExp(
  `^wompi_(${UUID})_(${PLAN})_(\\d+)$`,
  'i'
);
const RENEW_PATTERN = new RegExp(
  `^wompi_renew_(${UUID})_(\\d{8})_(\\d+)$`,
  'i'
);

export type WompiReferenceKind = 'first' | 'renewal' | 'legacy_first';

export interface ParsedWompiFirstReference {
  kind: 'first' | 'legacy_first';
  userId: string;
  planId: string;
  subscriptionId?: string;
  attemptNumber?: number;
  timestamp?: string;
}

export interface ParsedWompiRenewalReference {
  kind: 'renewal';
  subscriptionId: string;
  periodEndYmd: string;
  attemptNumber: number;
}

export type ParsedWompiReference =
  | ParsedWompiFirstReference
  | ParsedWompiRenewalReference;

/**
 * Deterministic first-charge reference keyed by subscription + attempt.
 * attemptNumber lets DECLINED retries use a fresh Wompi reference.
 */
export function buildWompiFirstReference(
  userId: string,
  planId: string,
  subscriptionId: string,
  attemptNumber = 1
): string {
  return `wompi_first_${userId}_${planId}_${subscriptionId}_${attemptNumber}`;
}

/** @deprecated Web Checkout era */
export function buildWompiLegacyReference(
  userId: string,
  planId: string,
  timestamp = Date.now()
): string {
  return `wompi_${userId}_${planId}_${timestamp}`;
}

export function buildWompiRenewalReference(
  subscriptionId: string,
  periodEnd: Date | string,
  attemptNumber: number
): string {
  const ymd = toPeriodEndYmd(periodEnd);
  return `wompi_renew_${subscriptionId}_${ymd}_${attemptNumber}`;
}

export function toPeriodEndYmd(periodEnd: Date | string): string {
  const d = typeof periodEnd === 'string' ? new Date(periodEnd) : periodEnd;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

export function parseWompiReference(
  reference: string
): ParsedWompiReference | null {
  const withAttempt = FIRST_WITH_ATTEMPT_PATTERN.exec(reference);
  if (withAttempt) {
    return {
      kind: 'first',
      userId: withAttempt[1],
      planId: withAttempt[2],
      subscriptionId: withAttempt[3],
      attemptNumber: Number(withAttempt[4]),
    };
  }

  const deterministic = FIRST_DETERMINISTIC_PATTERN.exec(reference);
  if (deterministic) {
    return {
      kind: 'first',
      userId: deterministic[1],
      planId: deterministic[2],
      subscriptionId: deterministic[3],
      attemptNumber: 1,
    };
  }

  const firstTs = FIRST_LEGACY_TS_PATTERN.exec(reference);
  if (firstTs) {
    return {
      kind: 'first',
      userId: firstTs[1],
      planId: firstTs[2],
      timestamp: firstTs[3],
    };
  }

  const renew = RENEW_PATTERN.exec(reference);
  if (renew) {
    return {
      kind: 'renewal',
      subscriptionId: renew[1],
      periodEndYmd: renew[2],
      attemptNumber: Number(renew[3]),
    };
  }

  const legacy = LEGACY_PATTERN.exec(reference);
  if (legacy) {
    return {
      kind: 'legacy_first',
      userId: legacy[1],
      planId: legacy[2],
      timestamp: legacy[3],
    };
  }

  return null;
}

export function isWompiRenewalReference(reference: string): boolean {
  return parseWompiReference(reference)?.kind === 'renewal';
}

export function isWompiFirstChargeReference(reference: string): boolean {
  const parsed = parseWompiReference(reference);
  return parsed?.kind === 'first' || parsed?.kind === 'legacy_first';
}
