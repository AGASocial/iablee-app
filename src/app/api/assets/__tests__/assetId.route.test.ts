/**
 * @jest-environment node
 */
import { PUT } from '../[assetId]/route';
import { createAuthenticatedRouteClient } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { canCreateVideoAsset, isVideoAssetType } from '@/lib/subscription/limits';

jest.mock('@/lib/supabase-server', () => ({
  createAuthenticatedRouteClient: jest.fn(),
}));
jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { from: jest.fn() },
}));
jest.mock('@/lib/subscription/limits', () => ({
  canCreateVideoAsset: jest.fn(),
  isVideoAssetType: jest.fn(),
}));

describe('PUT /api/assets/[assetId] video cap', () => {
  const mockCreateAuth = createAuthenticatedRouteClient as jest.Mock;
  const mockFrom = supabaseAdmin.from as jest.Mock;
  const mockIsVideo = isVideoAssetType as jest.Mock;
  const mockCanCreateVideo = canCreateVideoAsset as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateAuth.mockResolvedValue({
      supabase: {},
      user: { id: 'user-1' },
    });
  });

  function mockExistingAsset(assetType: string) {
    const maybeSingle = jest.fn().mockResolvedValue({
      data: { asset_type: assetType },
      error: null,
    });
    const updateSingle = jest.fn().mockResolvedValue({
      data: { id: 'asset-1', asset_type: 'video', asset_name: 'Clip' },
      error: null,
    });
    // First from() = select existing; second = update
    let call = 0;
    mockFrom.mockImplementation(() => {
      call += 1;
      if (call === 1) {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({ maybeSingle }),
            }),
          }),
        };
      }
      return {
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              select: jest.fn().mockReturnValue({
                single: updateSingle,
              }),
            }),
          }),
        }),
      };
    });
  }

  it('rejects type change to video when video cap is reached', async () => {
    mockExistingAsset('document');
    mockIsVideo
      .mockResolvedValueOnce(true) // becomingVideo
      .mockResolvedValueOnce(false); // alreadyVideo
    mockCanCreateVideo.mockResolvedValue({
      allowed: false,
      reason: 'videoLimitReached',
      limit: 5,
      current: 5,
    });

    const response = await PUT(
      new Request('http://localhost/api/assets/asset-1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asset_type: 'video', asset_name: 'Clip' }),
      }),
      { params: Promise.resolve({ assetId: 'asset-1' }) }
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe('LIMIT_REACHED');
    expect(body.message).toBe('videoLimitReached');
    expect(mockCanCreateVideo).toHaveBeenCalledWith({}, 'user-1');
  });

  it('skips video cap check when asset is already a video', async () => {
    mockExistingAsset('video');
    mockIsVideo
      .mockResolvedValueOnce(true) // becomingVideo
      .mockResolvedValueOnce(true); // alreadyVideo

    const response = await PUT(
      new Request('http://localhost/api/assets/asset-1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asset_type: 'video', asset_name: 'Clip updated' }),
      }),
      { params: Promise.resolve({ assetId: 'asset-1' }) }
    );

    expect(response.status).toBe(200);
    expect(mockCanCreateVideo).not.toHaveBeenCalled();
  });
});
