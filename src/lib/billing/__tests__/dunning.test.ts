/**
 * @jest-environment node
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  getDueDunningAttempt,
  isPastFinalDunningDay,
  extendPeriodEnd,
  hasPaidEntitlement,
  hasStatusBasedEntitlement,
  subscriptionGrantsPaidEntitlement,
  selectBestEntitledSubscription,
  ENTITLEMENT_GRACE_MS,
  MAX_DUNNING_ATTEMPTS,
  DUNNING_ATTEMPT_OFFSET_DAYS,
  daysInUtcMonth,
  clampUtcMonthDay,
  sameInstant,
  toEpochMs,
  normalizeSubscriptionStatus,
  isCanceledSubscriptionStatus,
  isPaidThroughRevokeReason,
  PAID_THROUGH_REVOKE_REASONS,
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

describe('subscriptionGrantsPaidEntitlement (KAN-168 CAPE paid-through)', () => {
  const periodEnd = new Date('2026-11-10T00:00:00.000Z');
  const beforeEnd = new Date('2026-11-09T12:00:00.000Z');

  type Case = {
    name: string;
    expected: boolean;
    params: Parameters<typeof subscriptionGrantsPaidEntitlement>[0];
  };

  const cases: Case[] = [
    // Positive: CAPE + active/canceled + future CPE
    {
      name: 'CAPE active stripe future → Premium',
      expected: true,
      params: {
        status: 'active',
        provider: 'stripe',
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: true,
        now: beforeEnd,
      },
    },
    {
      name: 'CAPE canceled after cron flip → Premium',
      expected: true,
      params: {
        status: 'canceled',
        provider: 'stripe',
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: true,
        canceledReason: 'user',
        now: beforeEnd,
      },
    },
    {
      name: 'CAPE cancelled spelling + case → Premium',
      expected: true,
      params: {
        status: 'CANCELLED',
        provider: 'payu',
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: true,
        now: beforeEnd,
      },
    },
    {
      name: 'CAPE Wompi within +1d grace → Premium',
      expected: true,
      params: {
        status: 'canceled',
        provider: 'wompi',
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: true,
        now: new Date(periodEnd.getTime() + ENTITLEMENT_GRACE_MS - 1000),
      },
    },
    {
      name: 'CAPE Wompi exact grace boundary → Premium',
      expected: true,
      params: {
        status: 'canceled',
        provider: 'wompi',
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: true,
        now: new Date(periodEnd.getTime() + ENTITLEMENT_GRACE_MS),
      },
    },
    // Negative: no CAPE / revoke / fail-closed
    {
      name: 'canceled without CAPE + future CPE → Free',
      expected: false,
      params: {
        status: 'canceled',
        provider: 'stripe',
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false,
        now: beforeEnd,
      },
    },
    {
      name: 'canceled CAPE omitted (webhook mid-period) → Free',
      expected: false,
      params: {
        status: 'canceled',
        provider: 'stripe',
        currentPeriodEnd: periodEnd,
        now: beforeEnd,
      },
    },
    {
      name: 'immediate cancel CAPE=false → Free',
      expected: false,
      params: {
        status: 'canceled',
        provider: 'wompi',
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false,
        canceledReason: 'user',
        now: beforeEnd,
      },
    },
    {
      name: 'CAPE + dunning reason → Free',
      expected: false,
      params: {
        status: 'canceled',
        provider: 'wompi',
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: true,
        canceledReason: 'dunning',
        now: beforeEnd,
      },
    },
    {
      name: 'CAPE + superseded → Free',
      expected: false,
      params: {
        status: 'canceled',
        provider: 'wompi',
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: true,
        canceledReason: 'superseded',
        now: beforeEnd,
      },
    },
    {
      name: 'CAPE + expired_resubscribe → Free',
      expected: false,
      params: {
        status: 'canceled',
        provider: 'wompi',
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: true,
        canceledReason: 'expired_resubscribe',
        now: beforeEnd,
      },
    },
    {
      name: 'CAPE + NULL CPE → Free (fail closed)',
      expected: false,
      params: {
        status: 'active',
        provider: 'stripe',
        currentPeriodEnd: null,
        cancelAtPeriodEnd: true,
        now: beforeEnd,
      },
    },
    {
      name: 'CAPE + invalid CPE → Free',
      expected: false,
      params: {
        status: 'active',
        provider: 'stripe',
        currentPeriodEnd: 'not-a-date',
        cancelAtPeriodEnd: true,
        now: beforeEnd,
      },
    },
    {
      name: 'CAPE past Stripe exact end → Free',
      expected: false,
      params: {
        status: 'active',
        provider: 'stripe',
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: true,
        now: new Date('2026-11-10T00:00:01.000Z'),
      },
    },
    {
      name: 'CAPE Wompi after grace → Free',
      expected: false,
      params: {
        status: 'canceled',
        provider: 'wompi',
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: true,
        now: new Date(periodEnd.getTime() + ENTITLEMENT_GRACE_MS + 1000),
      },
    },
  ];

  it.each(cases)('$name', ({ expected, params }) => {
    expect(subscriptionGrantsPaidEntitlement(params)).toBe(expected);
  });

  it('normalizes status case for non-CAPE Wompi active', () => {
    expect(
      subscriptionGrantsPaidEntitlement({
        status: 'ACTIVE',
        provider: 'wompi',
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false,
        now: beforeEnd,
      })
    ).toBe(true);
  });
});

describe('selectBestEntitledSubscription ranking', () => {
  it('ignores plan_free and prefers higher amount_cents', () => {
    const rows = [
      { id: 'free', planId: 'plan_free', amount: 0, entitled: true },
      { id: 'month', planId: 'plan_premium_month', amount: 999, entitled: true },
      { id: 'year', planId: 'plan_premium_year', amount: 9990, entitled: true },
    ];
    const best = selectBestEntitledSubscription(rows, {
      isEntitled: (r) => r.entitled,
      getPlanId: (r) => r.planId,
      getAmountCents: (r) => r.amount,
    });
    expect(best?.id).toBe('year');
  });
});

describe('status / revoke helpers', () => {
  it('normalizes and detects canceled spellings', () => {
    expect(normalizeSubscriptionStatus(' Canceled ')).toBe('canceled');
    expect(isCanceledSubscriptionStatus('CANCELLED')).toBe(true);
    expect(isCanceledSubscriptionStatus('active')).toBe(false);
  });

  it('lists revoke reasons used by SQL+TS', () => {
    expect([...PAID_THROUGH_REVOKE_REASONS]).toEqual([
      'dunning',
      'superseded',
      'expired_resubscribe',
    ]);
    expect(isPaidThroughRevokeReason('Dunning')).toBe(true);
    expect(isPaidThroughRevokeReason('user')).toBe(false);
  });
});

describe('SQL ↔ TS paid-through parity (KAN-168 migration)', () => {
  const migrationPath = join(
    process.cwd(),
    'supabase/migrations/20261119010000_kan168_paid_through_after_cancel.sql'
  );
  const sql = readFileSync(migrationPath, 'utf8');

  it('SQL requires CAPE for paid-through (not bare canceled)', () => {
    expect(sql).toContain('COALESCE(p_cancel_at_period_end, false) = true');
    expect(sql).not.toMatch(
      /v_is_ending\s*:=\s*[\s\S]*p_status IN \('canceled', 'cancelled'\)\s*OR/
    );
  });

  it('SQL mirrors revoke reasons and case-normalized status', () => {
    expect(sql).toContain("v_reason IN ('dunning', 'superseded', 'expired_resubscribe')");
    expect(sql).toContain("v_status := lower(trim(COALESCE(p_status, '')))");
    expect(sql).toContain('p_canceled_reason');
  });

  it('SQL resolve_user_max_storage_mb ignores plan_free and ranks by amount_cents', () => {
    expect(sql).toContain("bp.id IS DISTINCT FROM 'plan_free'");
    expect(sql).toContain('ORDER BY COALESCE(bp.amount_cents, 0) DESC');
    expect(sql).toContain('bs.canceled_reason');
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
