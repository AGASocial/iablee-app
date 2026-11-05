/**
 * @jest-environment node
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const sql = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261105000300_finalize_failed_pin_attempt.sql'),
  'utf8'
);

describe('finalize failed PIN attempt migration', () => {
  it('locks the fifth failure in the same database transaction as the compare result', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.finalize_failed_pin_attempt/);
    expect(sql).toMatch(/p_compare_failed boolean/);
    expect(sql).toMatch(/FOR UPDATE/);
    expect(sql).toMatch(/IF v_attempts >= 5 THEN/);
    expect(sql).toMatch(/pin_locked_until = v_next_locked/);
    expect(sql).toMatch(/pin_reset_locked_until = v_next_locked/);
    expect(sql).toMatch(/interval '15 minutes'/);
    expect(sql).toMatch(/finalize_failed_pin_attempt is service_role only/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.finalize_failed_pin_attempt\(uuid, text, boolean\) FROM PUBLIC, anon, authenticated/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.finalize_failed_pin_attempt\(uuid, text, boolean\) TO service_role/);
  });
});
