import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AddAssetForm from '../AddAssetForm';
import { supabase } from '@/lib/supabase';
import { ASSET_TYPES, getAssetType } from '@/constants/assetTypes';

// Mock dependencies
jest.mock('@/lib/supabase');
jest.mock('@/constants/assetTypes', () => ({
  ...jest.requireActual('@/constants/assetTypes'),
  getAssetType: jest.fn(),
}));

describe('AddAssetForm', () => {
  const mockSupabase = supabase as jest.Mocked<typeof supabase>;
  const mockUser = {
    id: 'user-123',
    email: 'test@example.com',
  };

  const mockOnSuccess = jest.fn();
  const mockOnCancel = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockSupabase.auth.getUser = jest.fn().mockResolvedValue({
      data: { user: mockUser },
      error: null,
    });
    mockSupabase.storage.from = jest.fn().mockReturnValue({
      upload: jest.fn().mockResolvedValue({
        data: { path: 'test-path' },
        error: null,
      }),
    });
    mockSupabase.from = jest.fn().mockReturnValue({
      insert: jest.fn().mockResolvedValue({
        data: null,
        error: null,
      }),
      update: jest.fn().mockReturnValue({
        eq: jest.fn().mockResolvedValue({
          data: null,
          error: null,
        }),
      }),
    });

    // Mock getAssetType
    (getAssetType as jest.Mock).mockImplementation((key: string) => {
      return ASSET_TYPES.find(t => t.key === key);
    });
  });

  it('should render form with required fields', () => {
    render(
      <AddAssetForm
        assetType="cartas"
        onSuccess={mockOnSuccess}
        onCancel={mockOnCancel}
      />
    );

    expect(screen.getByLabelText(/assetName/i)).toBeInTheDocument();
  });

  it('should show asset type specific fields', () => {
    render(
      <AddAssetForm
        assetType="cartas"
        onSuccess={mockOnSuccess}
        onCancel={mockOnCancel}
      />
    );

    // Cartas should have description field
    expect(screen.getByLabelText(/description/i)).toBeInTheDocument();
  });

  it('should submit form with valid data', async () => {
    const user = userEvent.setup();
    const mockInsert = jest.fn().mockResolvedValue({
      data: null,
      error: null,
    });

    mockSupabase.from = jest.fn().mockReturnValue({
      insert: mockInsert,
    });

    render(
      <AddAssetForm
        assetType="cartas"
        onSuccess={mockOnSuccess}
        onCancel={mockOnCancel}
      />
    );

    const assetNameInput = screen.getByLabelText(/assetName/i);
    await user.type(assetNameInput, 'Test Asset');

    const saveButton = screen.getByRole('button', { name: /save/i });
    await user.click(saveButton);

    await waitFor(() => {
      expect(mockInsert).toHaveBeenCalled();
      expect(mockOnSuccess).toHaveBeenCalled();
    });
  });

  it('should show error on submission failure', async () => {
    const user = userEvent.setup();
    const errorMessage = 'Failed to create asset';

    mockSupabase.from = jest.fn().mockReturnValue({
      insert: jest.fn().mockResolvedValue({
        data: null,
        error: { message: errorMessage },
      }),
    });

    render(
      <AddAssetForm
        assetType="cartas"
        onSuccess={mockOnSuccess}
        onCancel={mockOnCancel}
      />
    );

    const assetNameInput = screen.getByLabelText(/assetName/i);
    await user.type(assetNameInput, 'Test Asset');

    const saveButton = screen.getByRole('button', { name: /save/i });
    await user.click(saveButton);

    await waitFor(() => {
      expect(screen.getByText(errorMessage)).toBeInTheDocument();
    });
  });

  it('should handle file upload', async () => {
    const user = userEvent.setup();
    const mockUpload = jest.fn().mockResolvedValue({
      data: { path: 'user-123/test-file.pdf' },
      error: null,
    });

    mockSupabase.storage.from = jest.fn().mockReturnValue({
      upload: mockUpload,
    });

    render(
      <AddAssetForm
        assetType="documentos"
        onSuccess={mockOnSuccess}
        onCancel={mockOnCancel}
      />
    );

    const fileInput = screen.getByLabelText(/uploadFiles/i);
    const file = new File(['content'], 'test.pdf', { type: 'application/pdf' });
    await user.upload(fileInput, file);

    const assetNameInput = screen.getByLabelText(/assetName/i);
    await user.type(assetNameInput, 'Test Document');

    const saveButton = screen.getByRole('button', { name: /save/i });
    await user.click(saveButton);

    await waitFor(() => {
      expect(mockUpload).toHaveBeenCalled();
    });
  });

  it('should call onCancel when cancel button is clicked', async () => {
    const user = userEvent.setup();

    render(
      <AddAssetForm
        assetType="cartas"
        onSuccess={mockOnSuccess}
        onCancel={mockOnCancel}
      />
    );

    const cancelButton = screen.getByRole('button', { name: /cancel/i });
    await user.click(cancelButton);

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

    const mockEq = jest.fn().mockResolvedValue({
      data: null,
      error: null,
    });

    mockSupabase.from = jest.fn().mockReturnValue({
      update: jest.fn().mockReturnValue({
        eq: mockEq,
      }),
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

    const saveButton = screen.getByRole('button', { name: /save/i });
    await user.click(saveButton);

    await waitFor(() => {
      expect(mockEq).toHaveBeenCalledWith('id', 'asset-123');
      expect(mockOnSuccess).toHaveBeenCalled();
    });
  });
});

