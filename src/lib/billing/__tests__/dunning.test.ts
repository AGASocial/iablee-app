/**
 * @jest-environment node
 */
import {
  getDueDunningAttempt,
  isPastFinalDunningDay,
  extendPeriodEnd,
  hasPaidEntitlement,
  MAX_DUNNING_ATTEMPTS,
  DUNNING_ATTEMPT_OFFSET_DAYS,
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
    expect(
      getDueDunningAttempt(periodEnd, new Date('2026-11-20T08:00:00.000Z'))
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

describe('extendPeriodEnd', () => {
  it('extends month from previous period end (no drift)', () => {
    const prev = new Date('2026-01-15T07:00:00.000Z');
    const next = extendPeriodEnd(prev, 'month');
    expect(next.toISOString()).toBe('2026-02-15T07:00:00.000Z');
  });

  it('extends year from previous period end', () => {
    const prev = new Date('2026-03-15T12:00:00.000Z');
    const next = extendPeriodEnd(prev, 'year');
    expect(next.toISOString()).toBe('2027-03-15T12:00:00.000Z');
  });
});

describe('hasPaidEntitlement', () => {
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

  it('past_due loses Premium after dunning + grace', () => {
    expect(
      hasPaidEntitlement({
        status: 'past_due',
        currentPeriodEnd: periodEnd,
        now: new Date('2026-11-17T00:00:01.000Z'),
      })
    ).toBe(false);
  });

  it('canceled never entitles', () => {
    expect(
      hasPaidEntitlement({
        status: 'canceled',
        currentPeriodEnd: periodEnd,
        now: new Date('2026-11-09T00:00:00.000Z'),
      })
    ).toBe(false);
  });
});
