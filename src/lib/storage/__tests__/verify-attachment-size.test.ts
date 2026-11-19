/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';
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
  error: { message: string; status?: number } | null;
}) {
  const info = jest.fn(async () => infoResult);
  return {
    storage: {
      from: jest.fn(() => ({ info })),
    },
    _info: info,
  };
}

function mockAdminThrowing(err: unknown) {
  const info = jest.fn(async () => {
    throw err;
  });
  return {
    storage: {
      from: jest.fn(() => ({ info })),
    },
    _info: info,
  };
}

describe('resolveVerifiedAttachmentSize', () => {
  const userId = 'user-aaa-bbb';
  const pathOwned = `${userId}/123-doc.pdf`;
  const originalBucket = process.env.SUPABASE_STORAGE_BUCKET;

  afterEach(() => {
    if (originalBucket === undefined) delete process.env.SUPABASE_STORAGE_BUCKET;
    else process.env.SUPABASE_STORAGE_BUCKET = originalBucket;
  });

  it('returns metadata size when object exists under user prefix', async () => {
    const admin = mockAdmin({
      data: { name: pathOwned, metadata: { size: 1024 } },
      error: null,
    });

    const result = await resolveVerifiedAttachmentSize(
      admin as never,
      userId,
      pathOwned,
      null
    );

    expect(result).toEqual({ ok: true, size: 1024 });
    expect(admin.storage.from).toHaveBeenCalledWith('assets');
    expect(admin._info).toHaveBeenCalledWith(pathOwned);
  });

  it('uses configured storage bucket for the exact object probe', async () => {
    process.env.SUPABASE_STORAGE_BUCKET = 'test-assets';
    const admin = mockAdmin({
      data: { name: pathOwned, size: 50 },
      error: null,
    });

    const result = await resolveVerifiedAttachmentSize(
      admin as never,
      userId,
      pathOwned,
      null
    );

    expect(result).toEqual({ ok: true, size: 50 });
    expect(admin.storage.from).toHaveBeenCalledWith('test-assets');
  });

  it('accepts string metadata.size via Number()', async () => {
    const admin = mockAdmin({
      data: { name: pathOwned, metadata: { size: '2048' } },
      error: null,
    });

    const result = await resolveVerifiedAttachmentSize(
      admin as never,
      userId,
      pathOwned,
      null
    );

    expect(result).toEqual({ ok: true, size: 2048 });
  });

  it('rejects non-numeric / missing metadata.size', async () => {
    const admin = mockAdmin({
      data: { name: pathOwned, metadata: { size: 'not-a-number' } },
      error: null,
    });

    const result = await resolveVerifiedAttachmentSize(
      admin as never,
      userId,
      pathOwned,
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
      data: { name: pathOwned, metadata: {} },
      error: null,
    });

    const result = await resolveVerifiedAttachmentSize(
      admin as never,
      userId,
      pathOwned,
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
        name: pathOwned,
        metadata: { size: plaintext + ENCRYPTION_STREAM_OVERHEAD_BYTES },
      },
      error: null,
    });

    const result = await resolveVerifiedAttachmentSize(
      admin as never,
      userId,
      pathOwned,
      plaintext
    );

    expect(result).toEqual({ ok: true, size: plaintext });
  });

  it('rejects under-reported client file_size', async () => {
    const admin = mockAdmin({
      data: { name: pathOwned, metadata: { size: 5000 } },
      error: null,
    });

    const result = await resolveVerifiedAttachmentSize(
      admin as never,
      userId,
      pathOwned,
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

  it('maps StorageApiError status 404 to client 400', async () => {
    const admin = mockAdmin({
      data: null,
      error: { message: 'Object not found', status: 404 },
    });
    const result = await resolveVerifiedAttachmentSize(
      admin as never,
      userId,
      pathOwned,
      10
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toMatch(/not found/i);
    }
  });

  it('maps non-404 StorageApiError status to 500 (no message sniffing)', async () => {
    const admin = mockAdmin({
      data: null,
      // Message looks like 404 but status is 503 — must fail closed as 500
      error: { message: 'Object not found', status: 503 },
    });
    const result = await resolveVerifiedAttachmentSize(
      admin as never,
      userId,
      pathOwned,
      10
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(500);
    }
  });

  it('fails closed as 500 when error has no numeric status', async () => {
    const admin = mockAdmin({
      data: null,
      error: { message: 'Object not found' },
    });
    const result = await resolveVerifiedAttachmentSize(
      admin as never,
      userId,
      pathOwned,
      10
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(500);
    }
  });

  it('fails closed on unexpected throws from info()', async () => {
    const admin = mockAdminThrowing(new TypeError('network blew up'));
    const result = await resolveVerifiedAttachmentSize(
      admin as never,
      userId,
      pathOwned,
      10
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(500);
      expect(result.error).toMatch(/Failed to verify/i);
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

describe('KAN-168 storage quota migration (SQL contract)', () => {
  const sqlPath = path.join(
    process.cwd(),
    'supabase/migrations/20261118200000_kan168_premium_prices_storage.sql'
  );
  const sql = fs.readFileSync(sqlPath, 'utf8');
  const enforceBody = sql.slice(
    sql.indexOf('CREATE OR REPLACE FUNCTION public.enforce_user_storage_quota()'),
    sql.indexOf('DROP TRIGGER IF EXISTS trg_enforce_user_storage_quota')
  );

  it('does not hardcode bucket_id = assets in the quota trigger', () => {
    expect(enforceBody).not.toMatch(/bucket_id\s*=\s*'assets'/);
    expect(enforceBody).toMatch(/o\.name\s*=\s*NEW\.file_path/);
    expect(enforceBody).toMatch(/MAX\s*\(\s*\(o\.metadata->>'size'\)::bigint\s*\)/);
    expect(enforceBody).toMatch(/o\.owner\s+IS\s+NULL\s+OR\s+o\.owner\s*=\s*v_user_id/);
  });

  it('revokes all on trigger function with no EXECUTE grant', () => {
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.enforce_user_storage_quota\(\) FROM anon, authenticated, service_role/
    );
    expect(sql).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.enforce_user_storage_quota\(\)/
    );
  });
});
