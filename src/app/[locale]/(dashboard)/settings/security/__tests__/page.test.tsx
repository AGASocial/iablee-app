import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import SecuritySettingsPage from '../page';
import { useSecurity } from '@/context/SecurityContext';

jest.mock('@/context/SecurityContext', () => ({
  useSecurity: jest.fn(),
}));

jest.mock('@/hooks/useDataQueries', () => ({
  useUserProfile: () => ({ data: null, isLoading: false }),
}));

const mockUseSecurity = useSecurity as jest.Mock;
const mockFetch = global.fetch as jest.Mock;

function fillPin(startIndex: number, value: string) {
  fireEvent.change(screen.getAllByRole('textbox')[startIndex], { target: { value } });
}

describe('SecuritySettingsPage PIN errors', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockReset();
    mockUseSecurity.mockReturnValue({
      hasPin: true,
      locked: false,
      loading: false,
      checkStatus: jest.fn().mockResolvedValue(undefined),
    });
  });

  async function submitPins() {
    render(<SecuritySettingsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'changeSecurityPin' }));
    fillPin(0, '111111');
    fillPin(6, '222222');
    fillPin(12, '222222');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'changeSecurityPin' }));
    });
  }

  it('maps a locked PIN response to the localized lock message', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 423,
      json: async () => ({ error: 'PIN locked due to too many failed attempts' }),
    });

    await submitPins();

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('securityPinLocked');
    });
    expect(toast.error).not.toHaveBeenCalledWith('PIN locked due to too many failed attempts');
  });

  it('maps a reset-required response to the localized reset message', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: 'A verified reset code is required to replace an existing PIN' }),
    });

    await submitPins();

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('securityPinResetRequired');
    });
    expect(toast.error).not.toHaveBeenCalledWith(
      'A verified reset code is required to replace an existing PIN',
    );
  });
});
