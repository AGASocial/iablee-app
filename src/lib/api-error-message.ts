/**
 * Normalize JSON API error bodies for UI / i18n keys.
 * Prefers `code` (e.g. storageLimitReached), then `message`, then `error`.
 */
export function apiErrorToMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== 'object') {
    return fallback;
  }
  const record = body as Record<string, unknown>;
  if (typeof record.code === 'string' && record.code.length > 0) {
    return record.code;
  }
  if (typeof record.message === 'string' && record.message.length > 0) {
    return record.message;
  }
  if (typeof record.error === 'string' && record.error.length > 0) {
    return record.error;
  }
  return fallback;
}
