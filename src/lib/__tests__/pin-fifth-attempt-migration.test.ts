/**
 * @jest-environment node
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const sql = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261105000200_compare_fifth_pin_attempt.sql'),
  'utf8'
);

describe('fifth PIN attempt migration', () => {
  it('compares the attempt that reaches five and locks only after the cap is already used', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.begin_pin_attempt/);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.begin_pin_reset_attempt/);
    expect(sql).toMatch(/IF v_attempts >= 5 THEN/);
    expect(sql).not.toMatch(/v_next_attempts >= 5/);
    expect(sql).toMatch(/SELECT v_hash, v_next_attempts, NULL::timestamptz, false, true, v_version/);
    expect(sql).toMatch(/SELECT v_next_attempts, NULL::timestamptz, false, true, v_version/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.begin_pin_attempt\(uuid\) FROM PUBLIC, anon, authenticated/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.begin_pin_reset_attempt\(uuid\) TO service_role/);
  });
});
