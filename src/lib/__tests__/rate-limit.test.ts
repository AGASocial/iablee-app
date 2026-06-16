import {
  checkRateLimit,
  resetRateLimitStore,
  RATE_LIMITS,
} from '../rate-limit';

describe('rate-limit utility', () => {
  beforeEach(() => {
    resetRateLimitStore();
  });

  it('allows requests under the limit', () => {
    const config = { limit: 3, windowSec: 60 };
    const first = checkRateLimit('test:key', config);
    const second = checkRateLimit('test:key', config);

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(second.remaining).toBe(1);
  });

  it('blocks requests over the limit', () => {
    const config = { limit: 2, windowSec: 60 };
    checkRateLimit('blocked:key', config);
    checkRateLimit('blocked:key', config);
    const third = checkRateLimit('blocked:key', config);

    expect(third.allowed).toBe(false);
    expect(third.remaining).toBe(0);
  });

  it('isolates keys', () => {
    const config = { limit: 1, windowSec: 60 };
    checkRateLimit('a', config);
    const b = checkRateLimit('b', config);

    expect(b.allowed).toBe(true);
  });

  it('exposes preconfigured security pin limits', () => {
    expect(RATE_LIMITS.securityPin.limit).toBe(5);
    expect(RATE_LIMITS.securityPin.windowSec).toBe(60);
  });

  it('exposes preconfigured upload limits', () => {
    expect(RATE_LIMITS.upload.limit).toBe(20);
    expect(RATE_LIMITS.upload.windowSec).toBe(60);
  });
});
