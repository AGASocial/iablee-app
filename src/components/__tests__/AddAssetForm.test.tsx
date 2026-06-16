import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AddAssetForm from '../AddAssetForm';
import { useAssetType } from '@/lib/assetTypes';

jest.mock('@/lib/assetTypes', () => ({
  useAssetType: jest.fn(),
}));

const mockCartasType = {
  id: '1',
  key: 'cartas',
  label: 'Cartas',
  icon: 'Mail',
  requiredFields: ['asset_name'],
  optionalFields: ['description', 'email'],
  customFields: [],
  displayOrder: 1,
  isActive: true,
};

const mockDocumentosType = {
  id: '2',
  key: 'documentos',
  label: 'Documentos',
  icon: 'File',
  requiredFields: ['asset_name'],
  optionalFields: ['description', 'files'],
  fileAccept: '.pdf,.doc',
  customFields: [],
  displayOrder: 2,
  isActive: true,
};

describe('AddAssetForm', () => {
  const mockUseAssetType = useAssetType as jest.Mock;
  const mockOnSuccess = jest.fn();
  const mockOnCancel = jest.fn();
  const mockFetch = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = mockFetch;

    mockUseAssetType.mockImplementation((key: string) => ({
      data: key === 'documentos' ? mockDocumentosType : mockCartasType,
      isLoading: false,
    }));
  });

  it('should render form with required fields', () => {
    render(
      <AddAssetForm assetType="cartas" onSuccess={mockOnSuccess} onCancel={mockOnCancel} />
    );
    expect(screen.getByLabelText(/assetName/i)).toBeInTheDocument();
  });

  it('should show asset type specific fields', () => {
    render(
      <AddAssetForm assetType="cartas" onSuccess={mockOnSuccess} onCancel={mockOnCancel} />
    );
    expect(screen.getByLabelText(/description/i)).toBeInTheDocument();
  });

  it('should submit form with valid data', async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    render(
      <AddAssetForm assetType="cartas" onSuccess={mockOnSuccess} onCancel={mockOnCancel} />
    );

    await user.type(screen.getByLabelText(/assetName/i), 'Test Asset');
    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/assets', expect.objectContaining({ method: 'POST' }));
      expect(mockOnSuccess).toHaveBeenCalled();
    });
  });

  it('should show error on submission failure', async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Failed to create asset' }),
    });

    render(
      <AddAssetForm assetType="cartas" onSuccess={mockOnSuccess} onCancel={mockOnCancel} />
    );

    await user.type(screen.getByLabelText(/assetName/i), 'Test Asset');
    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(screen.getByText('Failed to create asset')).toBeInTheDocument();
    });
  });

  it('should handle file upload', async () => {
    const user = userEvent.setup();
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          path: 'user-123/test-file.pdf',
          fileName: 'test.pdf',
          fileType: 'document',
          fileSize: 100,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

    const { container } = render(
      <AddAssetForm assetType="documentos" onSuccess={mockOnSuccess} onCancel={mockOnCancel} />
    );

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['content'], 'test.pdf', { type: 'application/pdf' });
    await user.upload(fileInput, file);
    await user.type(screen.getByLabelText(/assetName/i), 'Test Document');
    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/storage/upload', expect.any(Object));
    });
  });

  it('should call onCancel when cancel button is clicked', async () => {
    const user = userEvent.setup();
    render(
      <AddAssetForm assetType="cartas" onSuccess={mockOnSuccess} onCancel={mockOnCancel} />
    );
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(mockOnCancel).toHaveBeenCalled();
  });

  it('should populate form when editing existing asset', () => {
    const existingAsset = {
      id: 'asset-123',
      asset_name: 'Existing Asset',
      email: 'test@example.com',
      description: 'Test description',
      asset_type: 'cartas',
      custom_fields: {},
      files: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    render(
      <AddAssetForm
        assetType="cartas"
        onSuccess={mockOnSuccess}
        onCancel={mockOnCancel}
        asset={existingAsset}
      />
    );

    expect(screen.getByDisplayValue('Existing Asset')).toBeInTheDocument();
    expect(screen.getByDisplayValue('test@example.com')).toBeInTheDocument();
  });

  it('should update existing asset on submit', async () => {
    const user = userEvent.setup();
    const existingAsset = {
      id: 'asset-123',
      asset_name: 'Existing Asset',
      asset_type: 'cartas',
      custom_fields: {},
      files: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    render(
      <AddAssetForm
        assetType="cartas"
        onSuccess={mockOnSuccess}
        onCancel={mockOnCancel}
        asset={existingAsset}
      />
    );

    const assetNameInput = screen.getByDisplayValue('Existing Asset');
    await user.clear(assetNameInput);
    await user.type(assetNameInput, 'Updated Asset');
    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/assets/asset-123',
        expect.objectContaining({ method: 'PUT' })
      );
      expect(mockOnSuccess).toHaveBeenCalled();
    });
  });
});
