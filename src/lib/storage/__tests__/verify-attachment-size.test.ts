/**
 * @jest-environment node
 */
import {
  ENCRYPTION_STREAM_OVERHEAD_BYTES,
  resolveVerifiedAttachmentSize,
  buildVerifiedAttachmentRows,
} from '../verify-attachment-size';

function mockAdmin(listResult: {
  data: Array<{ name: string; metadata?: { size?: number } }> | null;
  error: { message: string } | null;
}) {
  return {
    storage: {
      from: () => ({
        list: jest.fn(async () => listResult),
      }),
    },
  };
}

describe('resolveVerifiedAttachmentSize', () => {
  const userId = 'user-aaa-bbb';
  const path = `${userId}/123-doc.pdf`;

  it('returns metadata size when object exists under user prefix', async () => {
    const admin = mockAdmin({
      data: [{ name: '123-doc.pdf', metadata: { size: 1024 } }],
      error: null,
    });

    const result = await resolveVerifiedAttachmentSize(
      admin as never,
      userId,
      path,
      null
    );

    expect(result).toEqual({ ok: true, size: 1024 });
  });

  it('accepts plaintext client size matching encrypted metadata', async () => {
    const plaintext = 1000;
    const admin = mockAdmin({
      data: [
        {
          name: '123-doc.pdf',
          metadata: { size: plaintext + ENCRYPTION_STREAM_OVERHEAD_BYTES },
        },
      ],
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
      data: [{ name: '123-doc.pdf', metadata: { size: 5000 } }],
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
    const admin = mockAdmin({ data: [], error: null });
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
  });

  it('rejects missing storage objects', async () => {
    const admin = mockAdmin({ data: [], error: null });
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
});

describe('buildVerifiedAttachmentRows', () => {
  it('sums verified sizes for canUploadFile pre-check', async () => {
    const userId = 'user-1';
    const admin = {
      storage: {
        from: () => ({
          list: jest.fn(async (_folder: string, opts: { search: string }) => ({
            data: [{ name: opts.search, metadata: { size: 100 } }],
            error: null,
          })),
        }),
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
  });
});
