import { apiErrorToMessage } from '../api-error-message';


describe('apiErrorToMessage', () => {
  it('prefers code for storageLimitReached', () => {
    expect(
      apiErrorToMessage(
        { error: 'storageLimitReached', code: 'storageLimitReached', message: 'x' },
        'fallback'
      )
    ).toBe('storageLimitReached');
  });

  it('uses message when code is absent (LIMIT_REACHED)', () => {
    expect(
      apiErrorToMessage(
        { error: 'LIMIT_REACHED', message: 'assetLimitReached' },
        'fallback'
      )
    ).toBe('assetLimitReached');
  });

  it('falls back to error then fallback', () => {
    expect(apiErrorToMessage({ error: 'boom' }, 'fallback')).toBe('boom');
    expect(apiErrorToMessage(null, 'fallback')).toBe('fallback');
  });
});
