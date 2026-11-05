import { supabaseAdmin } from '@/lib/supabase-admin';
import { isPinLocked, PIN_LOCKOUT_MAX_ATTEMPTS } from '@/lib/pin-lockout';

export interface RecordedPinFailure {
  attempts: number;
  lockedUntil: string | null;
  locked: boolean;
  alreadyLocked: boolean;
  remainingAttempts: number;
}

interface FailureRow {
  failed_attempts: number;
  locked_until: string | null;
  already_locked: boolean;
}

function firstFailureRow(data: unknown): FailureRow | null {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') return null;
  const record = row as Record<string, unknown>;
  if (typeof record.failed_attempts !== 'number') return null;
  return {
    failed_attempts: record.failed_attempts,
    locked_until: typeof record.locked_until === 'string' ? record.locked_until : null,
    already_locked: record.already_locked === true,
  };
}

async function recordFailure(
  fn: 'record_pin_failed_attempt' | 'record_pin_reset_failed_attempt',
  userId: string
): Promise<RecordedPinFailure | null> {
  const { data, error } = await supabaseAdmin.rpc(fn, { p_user_id: userId });
  if (error) {
    console.error(`Error recording PIN failure via ${fn}:`, error);
    return null;
  }

  const row = firstFailureRow(data);
  if (!row) {
    console.error(`PIN failure via ${fn} returned no row`);
    return null;
  }

  const locked =
    row.already_locked ||
    row.failed_attempts >= PIN_LOCKOUT_MAX_ATTEMPTS ||
    isPinLocked(row.locked_until);

  return {
    attempts: row.failed_attempts,
    lockedUntil: row.locked_until,
    locked,
    alreadyLocked: row.already_locked,
    remainingAttempts: Math.max(0, PIN_LOCKOUT_MAX_ATTEMPTS - row.failed_attempts),
  };
}

/** Atomic `pin_failed_attempts = pin_failed_attempts + 1` in the database. */
export function recordPinFailedAttempt(userId: string): Promise<RecordedPinFailure | null> {
  return recordFailure('record_pin_failed_attempt', userId);
}

/** Atomic `pin_reset_failed_attempts = pin_reset_failed_attempts + 1` in the database. */
export function recordPinResetFailedAttempt(userId: string): Promise<RecordedPinFailure | null> {
  return recordFailure('record_pin_reset_failed_attempt', userId);
}
