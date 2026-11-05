/**
 * @jest-environment node
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const sql = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261104235900_pin_column_privileges_and_atomic_lockout.sql'),
  'utf8'
);

describe('pin hardening migration', () => {
  it('revokes table SELECT and does not grant security_pin_hash back to authenticated', () => {
    expect(sql).toMatch(/REVOKE SELECT ON TABLE public\.users FROM PUBLIC, anon, authenticated/);
    const grant = sql.match(/GRANT SELECT \(([\s\S]*?)\) ON TABLE public\.users TO authenticated/);
    expect(grant).not.toBeNull();
    expect(grant?.[1]).not.toMatch(/security_pin_hash/);
    expect(sql).toMatch(/GRANT SELECT ON TABLE public\.users TO service_role/);
  });

  it('increments PIN and reset failures in a single UPDATE', () => {
    expect(sql).toMatch(/pin_failed_attempts \+ 1/);
    expect(sql).toMatch(/pin_reset_failed_attempts \+ 1/);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.record_pin_failed_attempt/);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.record_pin_reset_failed_attempt/);
  });

  it('rejects get_my_beneficiary_relationships unless the role is service_role', () => {
    expect(sql).toMatch(/get_my_beneficiary_relationships is service_role only/);
    expect(sql).toMatch(/request_role\(\) IS DISTINCT FROM 'service_role'/);
  });

  it('closes open verification tokens when the beneficiary email changes', () => {
    expect(sql).toMatch(/UPDATE public\.beneficiary_email_verifications/);
    expect(sql).toMatch(/SET used_at = now\(\)/);
    expect(sql).toMatch(/beneficiary_id = NEW\.id/);
    expect(sql).toMatch(/AND used_at IS NULL/);
  });

  it('consumes a reset grant only while writing the new PIN', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.apply_pin_reset/);
    expect(sql).toMatch(/reset_grant_consumed_at = now\(\)/);
    expect(sql).toMatch(/reset_grant_consumed_at IS NULL/);
    expect(sql).toMatch(/security_pin_hash = p_pin_hash/);
  });
});
