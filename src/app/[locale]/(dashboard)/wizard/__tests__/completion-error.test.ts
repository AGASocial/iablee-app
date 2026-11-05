import en from '../../../../../../messages/en.json';
import es from '../../../../../../messages/es.json';
import { wizardApiErrorMessage } from '../completion-error';

describe('wizard completion PIN error', () => {
  it('maps the 403 Security PIN required response to localized copy', () => {
    const translate = (key: string) => (key === 'securityPinRequired' ? en.securityPinRequired : key);

    expect(wizardApiErrorMessage(403, 'Security PIN required', translate)).toBe(en.securityPinRequired);
    expect(wizardApiErrorMessage(403, 'LIMIT_REACHED', translate)).toBeNull();
    expect(wizardApiErrorMessage(400, 'Security PIN required', translate)).toBeNull();
    expect(en.securityPinRequired).not.toBe('Security PIN required');
    expect(es.securityPinRequired).not.toBe('Security PIN required');
    expect(es.securityPinRequired).not.toBe(en.securityPinRequired);
  });
});
