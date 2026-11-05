/**
 * @jest-environment node
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const sql = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261105120000_wizard_complete_idempotency.sql'),
  'utf8'
);

describe('wizard completion idempotency migration', () => {
  it('uses a non-blocking row lock for concurrent idempotency requests', () => {
    expect(sql).toMatch(/ON CONFLICT \(user_id, idempotency_key\) DO NOTHING/);
    expect(sql).toMatch(/FOR UPDATE NOWAIT/);
  });

  it('propagates lock_not_available as SQLSTATE 55P03', () => {
    expect(sql).toMatch(/WHEN lock_not_available THEN/);
    expect(sql).toMatch(/RAISE EXCEPTION 'idempotency key is currently being processed'/);
    expect(sql).toMatch(/USING ERRCODE = '55P03'/);
  });
});
