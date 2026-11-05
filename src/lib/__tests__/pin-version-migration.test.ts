/**
 * @jest-environment node
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const sql = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261105000100_pin_version_attempt_lock_email_verify.sql'),
  'utf8'
);

describe('pin version and verification migration', () => {
  it('locks the beneficiary and rolls back when the email no longer matches', () => {
    expect(sql).toMatch(/FROM public\.beneficiaries b\s+WHERE b\.id = v_beneficiary_id\s+FOR UPDATE/);
    expect(sql).toMatch(/SET\s+email_verified = true/);
    expect(sql).toMatch(/lower\(btrim\(email\)\) = lower\(btrim\(v_email\)\)/);
    expect(sql).toMatch(/SET used_at = now\(\)/);
    expect(sql).toMatch(/WHEN SQLSTATE 'P0001'/);
    expect(sql).toMatch(/beneficiary email no longer matches verification token/);
  });

  it('makes the email-change trigger security definer so it can burn tokens under RLS', () => {
    const fn = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.protect_beneficiary_email_verified'));
    expect(fn).toMatch(/SECURITY DEFINER/);
    expect(fn).toMatch(/SET search_path = public/);
    expect(sql).toMatch(/ALTER FUNCTION public\.protect_beneficiary_email_verified\(\) SECURITY DEFINER/);
    expect(fn).toMatch(/UPDATE public\.beneficiary_email_verifications/);
  });

  it('reserves a PIN attempt with a row lock before the caller may compare', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.begin_pin_attempt/);
    expect(sql).toMatch(/FOR UPDATE/);
    expect(sql).toMatch(/may_compare/);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.begin_pin_reset_attempt/);
    expect(sql).toMatch(/v_next_locked IS NULL/);
  });

  it('bumps the PIN version in the same update that writes a hash', () => {
    expect(sql).toMatch(/security_pin_version integer NOT NULL DEFAULT 0/);
    expect(sql).toMatch(/NEW\.security_pin_version := OLD\.security_pin_version \+ 1/);
    expect(sql).toMatch(/security_pin_version = security_pin_version \+ 1/);
    expect(sql).toMatch(/BEFORE UPDATE OF security_pin_hash/);
  });

  it('consumes unused reset grants and drops the unused email index', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.consume_open_pin_reset_grants/);
    expect(sql).toMatch(/reset_grant_consumed_at = now\(\)/);
    expect(sql).toMatch(/reset_grant_consumed_at IS NULL/);
    expect(sql).toMatch(/DROP INDEX IF EXISTS public\.beneficiaries_lower_email_verified_idx/);
  });
});
