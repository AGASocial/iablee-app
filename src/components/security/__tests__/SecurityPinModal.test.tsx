import { readFileSync } from 'fs';
import { join } from 'path';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SecurityPinModal from '../SecurityPinModal';

const RESET_KEYS = [
  'resetSecurityPin',
  'enterResetCode',
  'resetPinDescription',
  'enterResetCodeDescription',
  'sendVerificationCode',
  'backToPinEntry',
  'failedToSendResetEmail',
  'invalidResetCode',
  'invalidSecurityPin',
  'securityPinLocked',
  'securityPinRateLimited',
  'failedToVerifySecurityPin',
  'failedToSetSecurityPin',
  'securityPinResetRequired',
] as const;

describe('SecurityPinModal reset copy', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('localizes the reset flow in both message catalogs', () => {
    const en = JSON.parse(readFileSync(join(process.cwd(), 'messages/en.json'), 'utf8'));
    const es = JSON.parse(readFileSync(join(process.cwd(), 'messages/es.json'), 'utf8'));

    expect(es.emailNotVerified).toBe('Correo no verificado');
    for (const key of RESET_KEYS) {
      expect(en[key]).toEqual(expect.any(String));
      expect(es[key]).toEqual(expect.any(String));
      expect(es[key]).not.toBe(en[key]);
    }
  });

  it('renders reset titles, buttons, and errors through translations', async () => {
    const fetchMock = global.fetch as jest.Mock;
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: 'Invalid PIN' }),
      })
      .mockResolvedValueOnce({ ok: false, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Invalid code' }) });

    render(
      <SecurityPinModal isOpen mode="verify" onSuccess={jest.fn()} onCancel={jest.fn()} />
    );

    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: '123456' } });

    await waitFor(() => {
      expect(screen.getByText('invalidSecurityPin')).toBeInTheDocument();
    });
    expect(screen.queryByText('Invalid PIN')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'forgotPin' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'forgotPin' }));

    expect(screen.getByText('resetSecurityPin')).toBeInTheDocument();
    expect(screen.getByText('resetPinDescription')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'backToPinEntry' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'sendVerificationCode' }));

    await waitFor(() => {
      expect(screen.getByText('failedToSendResetEmail')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'sendVerificationCode' }));

    await waitFor(() => {
      expect(screen.getByText('enterResetCode')).toBeInTheDocument();
    });
    expect(screen.getByText('enterResetCodeDescription')).toBeInTheDocument();

    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: '654321' } });

    await waitFor(() => {
      expect(screen.getByText('invalidResetCode')).toBeInTheDocument();
    });
  });

  it('maps a locked PIN response to the localized lock message', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 423,
      json: async () => ({ error: 'PIN locked due to too many failed attempts' }),
    });

    render(
      <SecurityPinModal isOpen mode="verify" onSuccess={jest.fn()} onCancel={jest.fn()} />
    );

    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: '123456' } });

    await waitFor(() => {
      expect(screen.getByText('securityPinLocked')).toBeInTheDocument();
    });
    expect(screen.queryByText('PIN locked due to too many failed attempts')).not.toBeInTheDocument();
  });
});
