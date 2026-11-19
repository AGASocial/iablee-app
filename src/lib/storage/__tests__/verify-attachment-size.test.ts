/**
 * @jest-environment node
 */
import {
  ENCRYPTION_STREAM_OVERHEAD_BYTES,
  resolveVerifiedAttachmentSize,
  buildVerifiedAttachmentRows,
} from '../verify-attachment-size';

function mockAdmin(infoResult: {
  data: {
    name?: string;
    size?: number | string;
    metadata?: Record<string, unknown>;
  } | null;
  error: { message: string } | null;
}) {
  const info = jest.fn(async () => infoResult);
  return {
    storage: {
      from: jest.fn(() => ({ info })),
    },
    _info: info,
  };
}

describe('resolveVerifiedAttachmentSize', () => {
  const userId = 'user-aaa-bbb';
  const path = `${userId}/123-doc.pdf`;
  const originalBucket = process.env.SUPABASE_STORAGE_BUCKET;

  afterEach(() => {
    if (originalBucket === undefined) delete process.env.SUPABASE_STORAGE_BUCKET;
    else process.env.SUPABASE_STORAGE_BUCKET = originalBucket;
  });

  it('returns metadata size when object exists under user prefix', async () => {
    const admin = mockAdmin({
      data: { name: path, metadata: { size: 1024 } },
      error: null,
    });

    const result = await resolveVerifiedAttachmentSize(
      admin as never,
      userId,
      path,
      null
    );

    expect(result).toEqual({ ok: true, size: 1024 });
    expect(admin.storage.from).toHaveBeenCalledWith('assets');
    expect(admin._info).toHaveBeenCalledWith(path);
  });

  it('uses configured storage bucket for the exact object probe', async () => {
    process.env.SUPABASE_STORAGE_BUCKET = 'test-assets';
    const admin = mockAdmin({
      data: { name: path, size: 50 },
      error: null,
    });

    const result = await resolveVerifiedAttachmentSize(
      admin as never,
      userId,
      path,
      null
    );

    expect(result).toEqual({ ok: true, size: 50 });
    expect(admin.storage.from).toHaveBeenCalledWith('test-assets');
  });

  it('accepts string metadata.size via Number()', async () => {
    const admin = mockAdmin({
      data: { name: path, metadata: { size: '2048' } },
      error: null,
    });

    const result = await resolveVerifiedAttachmentSize(
      admin as never,
      userId,
      path,
      null
    );

    expect(result).toEqual({ ok: true, size: 2048 });
  });

  it('rejects non-numeric / missing metadata.size', async () => {
    const admin = mockAdmin({
      data: { name: path, metadata: { size: 'not-a-number' } },
      error: null,
    });

    const result = await resolveVerifiedAttachmentSize(
      admin as never,
      userId,
      path,
      10
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toMatch(/size unavailable/i);
    }
  });

  it('rejects when size fields are absent', async () => {
    const admin = mockAdmin({
      data: { name: path, metadata: {} },
      error: null,
    });

    const result = await resolveVerifiedAttachmentSize(
      admin as never,
      userId,
      path,
      null
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
    }
  });

  it('accepts plaintext client size matching encrypted metadata', async () => {
    const plaintext = 1000;
    const admin = mockAdmin({
      data: {
        name: path,
        metadata: { size: plaintext + ENCRYPTION_STREAM_OVERHEAD_BYTES },
      },
      error: null,
    });

    const result = await resolveVerifiedAttachmentSize(
      admin as never,
      userId,
      path,
      plaintext
    );

    expect(result).toEqual({ ok: true, size: plaintext });
  });

  it('rejects under-reported client file_size', async () => {
    const admin = mockAdmin({
      data: { name: path, metadata: { size: 5000 } },
      error: null,
    });

    const result = await resolveVerifiedAttachmentSize(
      admin as never,
      userId,
      path,
      0
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toMatch(/does not match/i);
    }
  });

  it('rejects paths not owned by user', async () => {
    const admin = mockAdmin({ data: null, error: null });
    const result = await resolveVerifiedAttachmentSize(
      admin as never,
      userId,
      'other-user/file.pdf',
      10
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(403);
    }
    expect(admin._info).not.toHaveBeenCalled();
  });

  it('rejects missing storage objects', async () => {
    const admin = mockAdmin({
      data: null,
      error: { message: 'Object not found' },
    });
    const result = await resolveVerifiedAttachmentSize(
      admin as never,
      userId,
      path,
      10
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
    }
  });

  it('fails closed on storage probe errors', async () => {
    const admin = mockAdmin({
      data: null,
      error: { message: 'network timeout' },
    });
    const result = await resolveVerifiedAttachmentSize(
      admin as never,
      userId,
      path,
      10
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(500);
    }
  });
});

describe('buildVerifiedAttachmentRows', () => {
  it('sums verified sizes for canUploadFile pre-check', async () => {
    const userId = 'user-1';
    const info = jest.fn(async (filePath: string) => ({
      data: { name: filePath, metadata: { size: 100 } },
      error: null,
    }));
    const admin = {
      storage: {
        from: () => ({ info }),
      },
    };

    const result = await buildVerifiedAttachmentRows(admin as never, userId, 'asset-1', [
      {
        path: `${userId}/a.pdf`,
        fileName: 'a.pdf',
        fileType: 'document',
        fileSize: 100,
      },
      {
        path: `${userId}/b.pdf`,
        fileName: 'b.pdf',
        fileType: 'document',
        fileSize: 100,
      },
    ]);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.totalBytes).toBe(200);
      expect(result.rows).toHaveLength(2);
      expect(result.rows[0].file_size).toBe(100);
    }
    expect(info).toHaveBeenCalledTimes(2);
  });
});
