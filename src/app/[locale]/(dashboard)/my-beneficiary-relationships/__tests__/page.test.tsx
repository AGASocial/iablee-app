import en from '../../../../../../messages/en.json';
import es from '../../../../../../messages/es.json';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import MyBeneficiaryRelationshipsPage from '../page';
import { useSecurity } from '@/context/SecurityContext';

jest.mock('@/context/SecurityContext', () => ({
  useSecurity: jest.fn(),
}));

const mockUseSecurity = useSecurity as jest.Mock;
const mockFetch = global.fetch as jest.Mock;

function securityState(overrides: { locked: boolean; loading?: boolean }) {
  return {
    locked: overrides.locked,
    loading: overrides.loading ?? false,
    hasPin: !overrides.locked,
    checkStatus: jest.fn().mockResolvedValue(undefined),
  };
}

describe('MyBeneficiaryRelationshipsPage', () => {
  it('has a dedicated unconfirmed-email message in English and Spanish', () => {
    expect(en.emailNotConfirmed.length).toBeGreaterThan(0);
    expect(es.emailNotConfirmed.length).toBeGreaterThan(0);
    expect(en.emailNotConfirmedDescription).not.toBe(en.error);
    expect(es.emailNotConfirmedDescription).not.toBe(es.error);
    expect(en.emailNotConfirmedDescription).not.toBe(es.emailNotConfirmedDescription);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockReset();
  });

  it('does not fetch while the PIN gate is locked', () => {
    mockUseSecurity.mockReturnValue(securityState({ locked: true }));

    render(<MyBeneficiaryRelationshipsPage />);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(screen.queryByText('Ada')).not.toBeInTheDocument();
  });

  it('fetches when the PIN gate unlocks', async () => {
    mockUseSecurity.mockReturnValue(securityState({ locked: true }));
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        relationships: [
          {
            holder_full_name: 'Ada',
            relationship_key: 'spouse',
            beneficiary_id: 'b1',
            email_verified_at: null,
            created_at: '2026-01-01T00:00:00Z',
          },
        ],
      }),
    });

    const { rerender } = render(<MyBeneficiaryRelationshipsPage />);
    expect(mockFetch).not.toHaveBeenCalled();

    mockUseSecurity.mockReturnValue(securityState({ locked: false }));
    rerender(<MyBeneficiaryRelationshipsPage />);

    expect(await screen.findByText('Ada')).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith('/api/beneficiaries/my-relationships');
    expect(screen.getByText('relationships.spouse')).toBeInTheDocument();

    mockUseSecurity.mockReturnValue(securityState({ locked: true }));
    rerender(<MyBeneficiaryRelationshipsPage />);

    await waitFor(() => {
      expect(screen.queryByText('Ada')).not.toBeInTheDocument();
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('falls back to relationships.other for an unknown key', async () => {
    mockUseSecurity.mockReturnValue(securityState({ locked: false }));
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        relationships: [
          {
            holder_full_name: 'Ada',
            relationship_key: 'not-a-real',
            beneficiary_id: 'b1',
            email_verified_at: null,
            created_at: '2026-01-01T00:00:00Z',
          },
        ],
      }),
    });

    render(<MyBeneficiaryRelationshipsPage />);

    expect(await screen.findByText('Ada')).toBeInTheDocument();
    expect(screen.getByText('relationships.other')).toBeInTheDocument();
    expect(screen.queryByText('relationships.not-a-real')).not.toBeInTheDocument();
  });

  it('shows a translated error without retry when a 403 does not unlock the gate', async () => {
    const state = securityState({ locked: false });
    mockUseSecurity.mockReturnValue(state);
    mockFetch.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: 'Security PIN required' }),
    });

    render(<MyBeneficiaryRelationshipsPage />);

    expect((await screen.findAllByText('error')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'retry' })).not.toBeInTheDocument();
    expect(screen.queryByText('loading')).not.toBeInTheDocument();
    expect(state.checkStatus).toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('shows the unconfirmed-email message and does not offer retry', async () => {
    mockUseSecurity.mockReturnValue(securityState({ locked: false }));
    mockFetch.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: 'Email confirmation required' }),
    });

    render(<MyBeneficiaryRelationshipsPage />);

    expect(await screen.findByText('emailNotConfirmed')).toBeInTheDocument();
    expect(screen.getByText('emailNotConfirmedDescription')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'retry' })).not.toBeInTheDocument();
  });

  it('reserves retry for server failures', async () => {
    mockUseSecurity.mockReturnValue(securityState({ locked: false }));
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Failed to fetch beneficiary relationships' }),
    });

    render(<MyBeneficiaryRelationshipsPage />);

    expect(await screen.findByRole('button', { name: 'retry' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'retry' }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });
});
