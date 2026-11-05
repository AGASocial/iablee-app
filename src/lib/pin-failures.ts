import { supabaseAdmin } from '@/lib/supabase-admin';
import { isPinLocked, nextLockoutExpiry, PIN_LOCKOUT_MAX_ATTEMPTS } from '@/lib/pin-lockout';

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

export interface PinAttemptClaim {
  pinHash: string | null;
  attempts: number;
  lockedUntil: string | null;
  alreadyLocked: boolean;
  mayCompare: boolean;
  pinVersion: number;
  remainingAttempts: number;
}

export interface PinResetAttemptClaim {
  attempts: number;
  lockedUntil: string | null;
  alreadyLocked: boolean;
  mayCompare: boolean;
  pinVersion: number;
  remainingAttempts: number;
}

function claimRow(data: unknown): Record<string, unknown> | null {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') return null;
  return row as Record<string, unknown>;
}

function lockedUntilOf(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** True when this reservation must not be compared (already locked, or the cap was already used). */
export function pinAttemptBlocksCompare(claim: { alreadyLocked: boolean; mayCompare: boolean; lockedUntil: string | null }): boolean {
  return claim.alreadyLocked || (!claim.mayCompare && claim.lockedUntil != null);
}

export type FailedPinCompareResult =
  | { action: 'continue'; remainingAttempts: number }
  | { action: 'locked'; lockedUntil: string; remainingAttempts: 0 }
  | { action: 'error' };

/**
 * The attempt that reaches the cap is compared first. Lock only after that compare fails.
 * A cleared counter (parallel success) matches zero rows and does not lock.
 */
export async function finishFailedPinCompare(
  userId: string,
  attempts: number,
  scope: 'pin' | 'reset'
): Promise<FailedPinCompareResult> {
  const remainingAttempts = Math.max(0, PIN_LOCKOUT_MAX_ATTEMPTS - attempts);
  if (attempts < PIN_LOCKOUT_MAX_ATTEMPTS) {
    return { action: 'continue', remainingAttempts };
  }

  const lockedUntil = nextLockoutExpiry();
  const attemptsColumn = scope === 'pin' ? 'pin_failed_attempts' : 'pin_reset_failed_attempts';
  const patch = scope === 'pin'
    ? { pin_locked_until: lockedUntil }
    : { pin_reset_locked_until: lockedUntil };

  const { data, error } = await supabaseAdmin
    .from('users')
    .update(patch)
    .eq('id', userId)
    .gte(attemptsColumn, PIN_LOCKOUT_MAX_ATTEMPTS)
    .select('id');

  if (error) {
    console.error('Error locking exhausted PIN attempts:', error);
    return { action: 'error' };
  }

  if (!data || data.length === 0) {
    return { action: 'continue', remainingAttempts: 0 };
  }

  return { action: 'locked', lockedUntil, remainingAttempts: 0 };
}

/**
 * Locks the user row and reserves a PIN attempt before bcrypt.
 * A locked result must not be compared.
 */
export async function beginPinAttempt(userId: string): Promise<PinAttemptClaim | null> {
  const { data, error } = await supabaseAdmin.rpc('begin_pin_attempt', { p_user_id: userId });
  if (error) {
    console.error('Error beginning PIN attempt:', error);
    return null;
  }

  const row = claimRow(data);
  if (!row || typeof row.failed_attempts !== 'number' || typeof row.pin_version !== 'number') {
    console.error('begin_pin_attempt returned no row');
    return null;
  }

  const attempts = row.failed_attempts;
  return {
    pinHash: typeof row.pin_hash === 'string' ? row.pin_hash : null,
    attempts,
    lockedUntil: lockedUntilOf(row.locked_until),
    alreadyLocked: row.already_locked === true,
    mayCompare: row.may_compare === true,
    pinVersion: row.pin_version,
    remainingAttempts: Math.max(0, PIN_LOCKOUT_MAX_ATTEMPTS - attempts),
  };
}

/** Locks the user row and reserves a reset attempt before the OTP lookup. */
export async function beginPinResetAttempt(userId: string): Promise<PinResetAttemptClaim | null> {
  const { data, error } = await supabaseAdmin.rpc('begin_pin_reset_attempt', { p_user_id: userId });
  if (error) {
    console.error('Error beginning PIN reset attempt:', error);
    return null;
  }

  const row = claimRow(data);
  if (!row || typeof row.failed_attempts !== 'number' || typeof row.pin_version !== 'number') {
    console.error('begin_pin_reset_attempt returned no row');
    return null;
  }

  const attempts = row.failed_attempts;
  return {
    attempts,
    lockedUntil: lockedUntilOf(row.locked_until),
    alreadyLocked: row.already_locked === true,
    mayCompare: row.may_compare === true,
    pinVersion: row.pin_version,
    remainingAttempts: Math.max(0, PIN_LOCKOUT_MAX_ATTEMPTS - attempts),
  };
}
