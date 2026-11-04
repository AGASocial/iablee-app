import { render, screen, waitFor } from '@testing-library/react';
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

  it('does not treat a PIN 403 as a fatal error', async () => {
    const state = securityState({ locked: false });
    mockUseSecurity.mockReturnValue(state);
    mockFetch.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: 'Security PIN required' }),
    });

    render(<MyBeneficiaryRelationshipsPage />);

    await waitFor(() => {
      expect(state.checkStatus).toHaveBeenCalled();
    });
    expect(screen.queryByText('error')).not.toBeInTheDocument();
    expect(screen.getByText('loading')).toBeInTheDocument();
  });
});
