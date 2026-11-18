/**
 * @jest-environment node
 */
import {
  buildWompiFirstReference,
  buildWompiRenewalReference,
  parseWompiReference,
  isWompiFirstChargeReference,
  isWompiRenewalReference,
  toPeriodEndYmd,
} from '../wompi-references';

describe('wompi references', () => {
  const userId = '48508890-08ea-40bc-8dc6-4a0860f6bc6a';
  const planId = 'plan_premium_month';
  const subId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

  it('builds and parses first-charge references', () => {
    const ref = buildWompiFirstReference(userId, planId, 1769218748365);
    expect(ref).toBe(`wompi_first_${userId}_${planId}_1769218748365`);
    expect(parseWompiReference(ref)).toEqual({
      kind: 'first',
      userId,
      planId,
      timestamp: '1769218748365',
    });
    expect(isWompiFirstChargeReference(ref)).toBe(true);
    expect(isWompiRenewalReference(ref)).toBe(false);
  });

  it('parses legacy web-checkout references', () => {
    const legacy = `wompi_${userId}_${planId}_1769218748365`;
    expect(parseWompiReference(legacy)?.kind).toBe('legacy_first');
    expect(isWompiFirstChargeReference(legacy)).toBe(true);
  });

  it('builds deterministic renewal references', () => {
    const periodEnd = new Date('2026-11-18T07:00:00.000Z');
    const ref = buildWompiRenewalReference(subId, periodEnd, 2);
    expect(ref).toBe(`wompi_renew_${subId}_20261118_2`);
    expect(parseWompiReference(ref)).toEqual({
      kind: 'renewal',
      subscriptionId: subId,
      periodEndYmd: '20261118',
      attemptNumber: 2,
    });
    expect(isWompiRenewalReference(ref)).toBe(true);
  });

  it('toPeriodEndYmd is UTC-stable', () => {
    expect(toPeriodEndYmd('2026-01-02T23:30:00.000Z')).toBe('20260102');
  });
});
