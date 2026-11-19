/**
 * @jest-environment node
 */
import {
  getDueDunningAttempt,
  isPastFinalDunningDay,
  extendPeriodEnd,
  hasPaidEntitlement,
  hasStatusBasedEntitlement,
  subscriptionGrantsPaidEntitlement,
  ENTITLEMENT_GRACE_MS,
  MAX_DUNNING_ATTEMPTS,
  DUNNING_ATTEMPT_OFFSET_DAYS,
  daysInUtcMonth,
  clampUtcMonthDay,
  sameInstant,
  toEpochMs,
} from '../dunning';

describe('dunning schedule', () => {
  const periodEnd = new Date('2026-11-10T07:00:00.000Z');

  it('exposes day 0/1/3/5 attempts', () => {
    expect(DUNNING_ATTEMPT_OFFSET_DAYS).toEqual([0, 1, 3, 5]);
    expect(MAX_DUNNING_ATTEMPTS).toBe(4);
  });

  it('returns null before period end', () => {
    expect(
      getDueDunningAttempt(periodEnd, new Date('2026-11-09T12:00:00.000Z'))
    ).toBeNull();
  });

  it('returns attempt 1 on day 0', () => {
    expect(
      getDueDunningAttempt(periodEnd, new Date('2026-11-10T08:00:00.000Z'))
    ).toBe(1);
  });

  it('returns attempt 2 on day 1', () => {
    expect(
      getDueDunningAttempt(periodEnd, new Date('2026-11-11T08:00:00.000Z'))
    ).toBe(2);
  });

  it('returns attempt 3 on day 3', () => {
    expect(
      getDueDunningAttempt(periodEnd, new Date('2026-11-13T08:00:00.000Z'))
    ).toBe(3);
  });

  it('returns attempt 4 on day 5+', () => {
    expect(
      getDueDunningAttempt(periodEnd, new Date('2026-11-15T08:00:00.000Z'))
    ).toBe(4);
  });

  it('detects past final dunning day', () => {
    expect(
      isPastFinalDunningDay(periodEnd, new Date('2026-11-14T08:00:00.000Z'))
    ).toBe(false);
    expect(
      isPastFinalDunningDay(periodEnd, new Date('2026-11-15T08:00:00.000Z'))
    ).toBe(true);
  });
});

describe('extendPeriodEnd month-end / leap-safe', () => {
  it('extends month from mid-month without drift', () => {
    const prev = new Date('2026-01-15T07:00:00.000Z');
    const next = extendPeriodEnd(prev, 'month');
    expect(next.toISOString()).toBe('2026-02-15T07:00:00.000Z');
  });

  it('clamps Jan 31 → Feb last day, then back to Mar 31 with anchor 31', () => {
    const jan31 = new Date('2026-01-31T12:00:00.000Z');
    const feb = extendPeriodEnd(jan31, 'month', 31);
    expect(feb.getUTCDate()).toBe(28); // 2026 not leap
    expect(feb.toISOString()).toBe('2026-02-28T12:00:00.000Z');

    const mar = extendPeriodEnd(feb, 'month', 31);
    expect(mar.toISOString()).toBe('2026-03-31T12:00:00.000Z');
  });

  it('leap year Feb 29 with anchor 31', () => {
    const jan31 = new Date('2024-01-31T08:00:00.000Z');
    const feb = extendPeriodEnd(jan31, 'month', 31);
    expect(feb.toISOString()).toBe('2024-02-29T08:00:00.000Z');
  });

  it('extends year with clamp', () => {
    const prev = new Date('2024-02-29T12:00:00.000Z');
    const next = extendPeriodEnd(prev, 'year', 29);
    expect(next.toISOString()).toBe('2025-02-28T12:00:00.000Z');
  });

  it('daysInUtcMonth and clampUtcMonthDay helpers', () => {
    expect(daysInUtcMonth(2026, 1)).toBe(28);
    expect(daysInUtcMonth(2024, 1)).toBe(29);
    const d = clampUtcMonthDay(2026, 1, 31, new Date('2026-01-31T01:02:03.000Z'));
    expect(d.toISOString()).toBe('2026-02-28T01:02:03.000Z');
  });
});

describe('hasPaidEntitlement (Wompi)', () => {
  const periodEnd = new Date('2026-11-10T00:00:00.000Z');

  it('active within period', () => {
    expect(
      hasPaidEntitlement({
        status: 'active',
        currentPeriodEnd: periodEnd,
        now: new Date('2026-11-09T00:00:00.000Z'),
      })
    ).toBe(true);
  });

  it('active within 1-day grace after period end', () => {
    expect(
      hasPaidEntitlement({
        status: 'active',
        currentPeriodEnd: periodEnd,
        now: new Date('2026-11-10T12:00:00.000Z'),
      })
    ).toBe(true);
  });

  it('active expires after grace', () => {
    expect(
      hasPaidEntitlement({
        status: 'active',
        currentPeriodEnd: periodEnd,
        now: new Date('2026-11-12T00:00:01.000Z'),
      })
    ).toBe(false);
  });

  it('past_due keeps Premium during dunning window', () => {
    expect(
      hasPaidEntitlement({
        status: 'past_due',
        currentPeriodEnd: periodEnd,
        now: new Date('2026-11-14T00:00:00.000Z'),
      })
    ).toBe(true);
  });

  it('canceled alone (legacy helper) does not entitle — use subscriptionGrantsPaidEntitlement', () => {
    expect(
      hasPaidEntitlement({
        status: 'canceled',
        currentPeriodEnd: periodEnd,
        now: new Date('2026-11-09T00:00:00.000Z'),
      })
    ).toBe(false);
  });
});

describe('hasStatusBasedEntitlement (Stripe/PayU)', () => {
  it('active and trialing grant access', () => {
    expect(hasStatusBasedEntitlement('active')).toBe(true);
    expect(hasStatusBasedEntitlement('trialing')).toBe(true);
  });

  it('past_due and canceled do not (status-only path)', () => {
    expect(hasStatusBasedEntitlement('past_due')).toBe(false);
    expect(hasStatusBasedEntitlement('canceled')).toBe(false);
  });
});

describe('subscriptionGrantsPaidEntitlement (KAN-168 paid-through)', () => {
  const periodEnd = new Date('2026-11-10T00:00:00.000Z');

  it('canceled with future period end → Premium (all providers)', () => {
    expect(
      subscriptionGrantsPaidEntitlement({
        status: 'canceled',
        provider: 'stripe',
        currentPeriodEnd: periodEnd,
        now: new Date('2026-11-09T12:00:00.000Z'),
      })
    ).toBe(true);
    expect(
      subscriptionGrantsPaidEntitlement({
        status: 'cancelled',
        provider: 'payu',
        currentPeriodEnd: periodEnd,
        now: new Date('2026-11-09T12:00:00.000Z'),
      })
    ).toBe(true);
    expect(
      subscriptionGrantsPaidEntitlement({
        status: 'canceled',
        provider: 'wompi',
        currentPeriodEnd: periodEnd,
        now: new Date('2026-11-09T12:00:00.000Z'),
      })
    ).toBe(true);
  });

  it('canceled with past period end → Free', () => {
    expect(
      subscriptionGrantsPaidEntitlement({
        status: 'canceled',
        provider: 'stripe',
        currentPeriodEnd: periodEnd,
        now: new Date('2026-11-11T00:00:01.000Z'),
      })
    ).toBe(false);
  });

  it('canceled with NULL current_period_end → Free (fail closed)', () => {
    expect(
      subscriptionGrantsPaidEntitlement({
        status: 'canceled',
        provider: 'stripe',
        currentPeriodEnd: null,
        now: new Date('2026-11-09T00:00:00.000Z'),
      })
    ).toBe(false);
    expect(
      subscriptionGrantsPaidEntitlement({
        status: 'canceled',
        provider: 'wompi',
        currentPeriodEnd: null,
        cancelAtPeriodEnd: true,
        now: new Date('2026-11-09T00:00:00.000Z'),
      })
    ).toBe(false);
  });

  it('cancel_at_period_end active with future period → Premium', () => {
    expect(
      subscriptionGrantsPaidEntitlement({
        status: 'active',
        provider: 'stripe',
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: true,
        now: new Date('2026-11-09T00:00:00.000Z'),
      })
    ).toBe(true);
  });

  it('cancel_at_period_end past period → Free (Stripe exact end)', () => {
    expect(
      subscriptionGrantsPaidEntitlement({
        status: 'active',
        provider: 'stripe',
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: true,
        now: new Date('2026-11-10T00:00:01.000Z'),
      })
    ).toBe(false);
  });

  it('Wompi canceled keeps +1 day grace after period end', () => {
    const withinGrace = new Date(periodEnd.getTime() + ENTITLEMENT_GRACE_MS - 1000);
    const afterGrace = new Date(periodEnd.getTime() + ENTITLEMENT_GRACE_MS + 1000);
    expect(
      subscriptionGrantsPaidEntitlement({
        status: 'canceled',
        provider: 'wompi',
        currentPeriodEnd: periodEnd,
        now: withinGrace,
      })
    ).toBe(true);
    expect(
      subscriptionGrantsPaidEntitlement({
        status: 'canceled',
        provider: 'wompi',
        currentPeriodEnd: periodEnd,
        now: afterGrace,
      })
    ).toBe(false);
  });

  it('Wompi grace boundary: exactly period_end + grace still entitles', () => {
    expect(
      subscriptionGrantsPaidEntitlement({
        status: 'canceled',
        provider: 'wompi',
        currentPeriodEnd: periodEnd,
        now: new Date(periodEnd.getTime() + ENTITLEMENT_GRACE_MS),
      })
    ).toBe(true);
  });
});

describe('sameInstant / toEpochMs', () => {
  it('equates PostgREST +00:00 with toISOString .000Z', () => {
    expect(
      sameInstant('2026-11-10T07:00:00.000Z', '2026-11-10T07:00:00+00:00')
    ).toBe(true);
    expect(toEpochMs('2026-11-10T07:00:00.000Z')).toBe(
      toEpochMs('2026-11-10T07:00:00+00:00')
    );
  });

  it('returns false for null / invalid', () => {
    expect(sameInstant(null, '2026-11-10T07:00:00.000Z')).toBe(false);
    expect(toEpochMs('not-a-date')).toBeNull();
  });
});
