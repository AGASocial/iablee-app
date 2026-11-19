/**
 * Wompi dunning schedule (KAN-166).
 *
 * Timeline relative to current_period_end (day 0 = period end):
 * - Day 0: attempt 1 (initial renewal charge)
 * - Day 1: attempt 2
 * - Day 3: attempt 3
 * - Day 5: attempt 4 (final) → on failure, downgrade to Free
 *
 * Entitlement grace: 1 calendar day after period end so a delayed cron
 * does not flicker Premium → Free for still-active users.
 * past_due keeps Premium until final dunning failure (day 5).
 */

export const DUNNING_ATTEMPT_OFFSET_DAYS = [0, 1, 3, 5] as const;

export const MAX_DUNNING_ATTEMPTS = DUNNING_ATTEMPT_OFFSET_DAYS.length;

/** Safety buffer so cron delay does not strip entitlements. */
export const ENTITLEMENT_GRACE_MS = 24 * 60 * 60 * 1000;

/** How long past_due may retain Premium (through final retry day). */
export const DUNNING_WINDOW_DAYS = 5;

export const UPCOMING_RENEWAL_DAYS = 3;

/**
 * Claimed attempts without a tx id older than this may be reconciled via
 * reference lookup. Abandon (mark error) only when lookup returns empty.
 */
export const CLAIM_STALE_MS = 15 * 60 * 1000;

/**
 * Epoch ms for a timestamptz / Date. Prefer this over string === for period equality
 * (PostgREST may return `+00:00` while `toISOString()` writes `.000Z`).
 */
export function toEpochMs(value: Date | string | null | undefined): number | null {
  if (value == null) return null;
  const ms = typeof value === 'string' ? new Date(value).getTime() : value.getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** True when both timestamps denote the same instant. */
export function sameInstant(
  a: Date | string | null | undefined,
  b: Date | string | null | undefined
): boolean {
  const am = toEpochMs(a);
  const bm = toEpochMs(b);
  return am != null && bm != null && am === bm;
}

/**
 * Which attempt number (1-based) is due now for a subscription whose
 * period ended at `periodEnd`, given current time `now`.
 */
export function getDueDunningAttempt(
  periodEnd: Date | string,
  now: Date = new Date()
): number | null {
  const end = typeof periodEnd === 'string' ? new Date(periodEnd) : periodEnd;
  const msSinceEnd = now.getTime() - end.getTime();
  if (msSinceEnd < 0) {
    return null;
  }

  const daysSinceEnd = Math.floor(msSinceEnd / (24 * 60 * 60 * 1000));

  let dueAttempt: number | null = null;
  for (let i = 0; i < DUNNING_ATTEMPT_OFFSET_DAYS.length; i++) {
    if (daysSinceEnd >= DUNNING_ATTEMPT_OFFSET_DAYS[i]) {
      dueAttempt = i + 1;
    }
  }
  return dueAttempt;
}

/**
 * True when we are past the final dunning day and should downgrade
 * if no APPROVED renewal exists for this period.
 */
export function isPastFinalDunningDay(
  periodEnd: Date | string,
  now: Date = new Date()
): boolean {
  const end = typeof periodEnd === 'string' ? new Date(periodEnd) : periodEnd;
  const msSinceEnd = now.getTime() - end.getTime();
  const daysSinceEnd = Math.floor(msSinceEnd / (24 * 60 * 60 * 1000));
  return daysSinceEnd >= DUNNING_WINDOW_DAYS;
}

/** Last UTC day of a given year/month (month 0-based). */
export function daysInUtcMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/**
 * Build a UTC date clamping `day` to the last day of the target month,
 * preserving time-of-day from `timeSource`.
 */
export function clampUtcMonthDay(
  year: number,
  monthIndex: number,
  day: number,
  timeSource: Date
): Date {
  const last = daysInUtcMonth(year, monthIndex);
  const clampedDay = Math.min(Math.max(1, day), last);
  return new Date(
    Date.UTC(
      year,
      monthIndex,
      clampedDay,
      timeSource.getUTCHours(),
      timeSource.getUTCMinutes(),
      timeSource.getUTCSeconds(),
      timeSource.getUTCMilliseconds()
    )
  );
}

/**
 * Extend a period end by plan interval, starting from the previous period end
 * (not from "now") so delayed renewals do not drift.
 *
 * `billingAnchorDay` (1–31) is the original billing day-of-month; when omitted,
 * uses the previous period end's UTC date. Month-end and leap days clamp to the
 * last valid day of the target month (Jan 31 → Feb 28/29 → Mar 31).
 */
export function extendPeriodEnd(
  previousPeriodEnd: Date | string,
  interval: 'month' | 'year',
  billingAnchorDay?: number | null
): Date {
  const prev =
    typeof previousPeriodEnd === 'string'
      ? new Date(previousPeriodEnd)
      : new Date(previousPeriodEnd.getTime());

  const anchor =
    billingAnchorDay && billingAnchorDay >= 1 && billingAnchorDay <= 31
      ? billingAnchorDay
      : prev.getUTCDate();

  if (interval === 'year') {
    return clampUtcMonthDay(
      prev.getUTCFullYear() + 1,
      prev.getUTCMonth(),
      anchor,
      prev
    );
  }

  let year = prev.getUTCFullYear();
  let month = prev.getUTCMonth() + 1;
  if (month > 11) {
    month = 0;
    year += 1;
  }
  return clampUtcMonthDay(year, month, anchor, prev);
}

/**
 * Revocation reasons that must NOT keep paid-through even when
 * cancel_at_period_end is still true (tombstones / dunning / supersede).
 * Mirrors SQL `subscription_grants_paid_entitlement`.
 */
export const PAID_THROUGH_REVOKE_REASONS = [
  'dunning',
  'superseded',
  'expired_resubscribe',
] as const;

/** Normalize subscription status for case-insensitive comparisons (TS + SQL). */
export function normalizeSubscriptionStatus(status: string): string {
  return status.trim().toLowerCase();
}

/** True for canceled / cancelled spelling variants (case-insensitive). */
export function isCanceledSubscriptionStatus(status: string): boolean {
  const s = normalizeSubscriptionStatus(status);
  return s === 'canceled' || s === 'cancelled';
}

export function isPaidThroughRevokeReason(
  reason: string | null | undefined
): boolean {
  if (reason == null || reason === '') return false;
  const normalized = reason.trim().toLowerCase();
  return (PAID_THROUGH_REVOKE_REASONS as readonly string[]).includes(normalized);
}

export function isFreePlanId(planId: string | null | undefined): boolean {
  return !planId || planId === 'plan_free';
}

/**
 * Product-tier ranks for entitled paid rows.
 * Mirrored in SQL `resolve_user_max_storage_mb` (KAN-168 migration).
 *
 * Rule: plan id prefix — `plan_premium_*` > `plan_necessary_*` > other paid.
 * Do NOT use `amount_cents` (Premium display USD can be lower than Necessary).
 */
export const PLAN_TIER_RANK = {
  premium: 300,
  necessary: 200,
  otherPaid: 100,
  free: -1,
} as const;

/**
 * Rank among entitled paid rows by product tier (plan id prefix).
 * Free plans return -1. Ties preserve caller order (updated_at DESC).
 */
export function entitledPlanRank(planId: string | null | undefined): number {
  if (isFreePlanId(planId)) return PLAN_TIER_RANK.free;
  const id = planId as string;
  if (id.startsWith('plan_premium_')) return PLAN_TIER_RANK.premium;
  if (id.startsWith('plan_necessary_')) return PLAN_TIER_RANK.necessary;
  return PLAN_TIER_RANK.otherPaid;
}

/**
 * Instant when paid-through entitlement ends (Wompi includes +1d grace).
 * Null when period end is missing/invalid.
 */
export function paidThroughEntitlementEndMs(params: {
  provider?: string | null;
  currentPeriodEnd: Date | string;
  graceMs?: number;
}): number | null {
  const end =
    typeof params.currentPeriodEnd === 'string'
      ? new Date(params.currentPeriodEnd)
      : params.currentPeriodEnd;
  if (!Number.isFinite(end.getTime())) return null;
  const grace =
    params.provider === 'wompi'
      ? (params.graceMs ?? ENTITLEMENT_GRACE_MS)
      : 0;
  return end.getTime() + grace;
}

/**
 * Pick the highest-tier entitled non-free row. Caller should pass rows
 * ordered by updated_at DESC so equal ranks keep the newest.
 */
export function selectBestEntitledSubscription<T>(
  rows: T[],
  opts: {
    isEntitled: (row: T) => boolean;
    getPlanId: (row: T) => string | null | undefined;
  }
): T | null {
  let best: T | null = null;
  let bestRank = -Infinity;
  for (const row of rows) {
    if (!opts.isEntitled(row)) continue;
    const planId = opts.getPlanId(row);
    if (isFreePlanId(planId)) continue;
    const rank = entitledPlanRank(planId);
    if (rank > bestRank) {
      bestRank = rank;
      best = row;
    }
  }
  return best;
}

/**
 * Whether a Wompi subscription still grants paid entitlements
 * (period end + grace / past_due dunning window).
 * Does not handle canceled/CAPE — use {@link subscriptionGrantsPaidEntitlement}.
 * Stripe/PayU must NOT use this for active paths — they stay status-based.
 */
export function hasPaidEntitlement(params: {
  status: string;
  currentPeriodEnd?: Date | string | null;
  now?: Date;
  graceMs?: number;
}): boolean {
  const now = params.now ?? new Date();
  const graceMs = params.graceMs ?? ENTITLEMENT_GRACE_MS;
  const status = normalizeSubscriptionStatus(params.status);
  const { currentPeriodEnd } = params;

  if (status === 'past_due') {
    if (!currentPeriodEnd) return true;
    const end =
      typeof currentPeriodEnd === 'string'
        ? new Date(currentPeriodEnd)
        : currentPeriodEnd;
    const cutoff =
      end.getTime() + DUNNING_WINDOW_DAYS * 24 * 60 * 60 * 1000 + graceMs;
    return now.getTime() <= cutoff;
  }

  if (status !== 'active' && status !== 'trialing') {
    return false;
  }

  if (!currentPeriodEnd) {
    return true;
  }

  const end =
    typeof currentPeriodEnd === 'string'
      ? new Date(currentPeriodEnd)
      : currentPeriodEnd;
  return now.getTime() <= end.getTime() + graceMs;
}

/**
 * Status-only entitlement for Stripe/PayU (pre-KAN-166 behavior).
 * Ignores current_period_end entirely. Does not grant canceled/CAPE.
 */
export function hasStatusBasedEntitlement(status: string): boolean {
  const s = normalizeSubscriptionStatus(status);
  return s === 'active' || s === 'trialing';
}

/**
 * Unified paid entitlement (KAN-168). Mirrors SQL
 * `subscription_grants_paid_entitlement`.
 *
 * Paid-through applies ONLY when cancel_at_period_end = true (user period-end
 * cancel): status may be active/trialing/past_due, or canceled after cron/webhook
 * flips at period end. Requires known current_period_end (NULL → Free).
 * Wompi keeps +1 day grace on that path; Stripe/PayU end at CPE.
 *
 * Any cancel without CAPE (immediate, refunds, chargebacks, admin, Wompi
 * void/decline, dunning, superseded, expired_resubscribe, mid-period
 * subscription.deleted) → no paid-through. Revoke reasons also deny
 * paid-through even if CAPE is still true.
 */
export function subscriptionGrantsPaidEntitlement(params: {
  status: string;
  provider?: string | null;
  currentPeriodEnd?: Date | string | null;
  cancelAtPeriodEnd?: boolean | null;
  canceledReason?: string | null;
  now?: Date;
  graceMs?: number;
}): boolean {
  const now = params.now ?? new Date();
  const graceMs = params.graceMs ?? ENTITLEMENT_GRACE_MS;
  const status = normalizeSubscriptionStatus(params.status);

  // Paid-through: CAPE is the sole user period-end signal.
  if (params.cancelAtPeriodEnd === true) {
    if (isPaidThroughRevokeReason(params.canceledReason)) {
      return false;
    }
    const statusOk =
      status === 'active' ||
      status === 'trialing' ||
      status === 'past_due' ||
      isCanceledSubscriptionStatus(status);
    if (!statusOk) {
      return false;
    }
    if (params.currentPeriodEnd == null) {
      return false;
    }
    const end =
      typeof params.currentPeriodEnd === 'string'
        ? new Date(params.currentPeriodEnd)
        : params.currentPeriodEnd;
    if (!Number.isFinite(end.getTime())) {
      return false;
    }
    const grace = params.provider === 'wompi' ? graceMs : 0;
    return now.getTime() <= end.getTime() + grace;
  }

  if (params.provider === 'wompi') {
    return hasPaidEntitlement({
      status,
      currentPeriodEnd: params.currentPeriodEnd,
      now,
      graceMs,
    });
  }

  return hasStatusBasedEntitlement(status);
}
