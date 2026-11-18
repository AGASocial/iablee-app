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

  it('builds deterministic first-charge references (no Date.now)', () => {
    const ref = buildWompiFirstReference(userId, planId, subId);
    expect(ref).toBe(`wompi_first_${userId}_${planId}_${subId}`);
    expect(parseWompiReference(ref)).toEqual({
      kind: 'first',
      userId,
      planId,
      subscriptionId: subId,
    });
    expect(isWompiFirstChargeReference(ref)).toBe(true);
  });

  it('parses legacy timestamp first-charge and web-checkout refs', () => {
    const firstTs = `wompi_first_${userId}_${planId}_1769218748365`;
    expect(parseWompiReference(firstTs)?.kind).toBe('first');
    const legacy = `wompi_${userId}_${planId}_1769218748365`;
    expect(parseWompiReference(legacy)?.kind).toBe('legacy_first');
  });

  it('builds deterministic renewal references', () => {
    const periodEnd = new Date('2026-11-18T07:00:00.000Z');
    const ref = buildWompiRenewalReference(subId, periodEnd, 2);
    expect(ref).toBe(`wompi_renew_${subId}_20261118_2`);
    expect(isWompiRenewalReference(ref)).toBe(true);
  });

  it('toPeriodEndYmd is UTC-stable', () => {
    expect(toPeriodEndYmd('2026-01-02T23:30:00.000Z')).toBe('20260102');
  });
});
