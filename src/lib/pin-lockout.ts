/** PIN lockout policy — max failures before temporary lock */
export const PIN_LOCKOUT_MAX_ATTEMPTS = 5;
export const PIN_LOCKOUT_DURATION_MS = 15 * 60 * 1000;

export function isPinLocked(pinLockedUntil: string | null | undefined): boolean {
  if (!pinLockedUntil) return false;
  return new Date(pinLockedUntil).getTime() > Date.now();
}

export function nextLockoutExpiry(): string {
  return new Date(Date.now() + PIN_LOCKOUT_DURATION_MS).toISOString();
}
