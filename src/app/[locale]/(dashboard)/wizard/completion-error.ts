export function wizardApiErrorMessage(
  status: number,
  error: unknown,
  translate: (key: string) => string,
): string | null {
  if (status === 403 && error === 'Security PIN required') {
    return translate('securityPinRequired');
  }
  return null;
}
