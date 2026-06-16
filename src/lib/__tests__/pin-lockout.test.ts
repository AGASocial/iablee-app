import {
  isPinLocked,
  nextLockoutExpiry,
  PIN_LOCKOUT_MAX_ATTEMPTS,
} from '../pin-lockout';

describe('pin-lockout utility', () => {
  it('detects active lockout', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(isPinLocked(future)).toBe(true);
  });

  it('detects expired lockout', () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    expect(isPinLocked(past)).toBe(false);
  });

  it('treats null as not locked', () => {
    expect(isPinLocked(null)).toBe(false);
  });

  it('returns future expiry for lockout', () => {
    const expiry = nextLockoutExpiry();
    expect(new Date(expiry).getTime()).toBeGreaterThan(Date.now());
  });

  it('defaults max attempts to 5', () => {
    expect(PIN_LOCKOUT_MAX_ATTEMPTS).toBe(5);
  });
});
