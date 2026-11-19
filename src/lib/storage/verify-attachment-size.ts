/**
 * Server-side verification of attachment byte sizes against Storage metadata.
 * Never trust client-supplied file_size alone for quota accounting (KAN-168).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

/** AES-GCM stream overhead from createEncryptionStream: version(1) + IV(12) + tag(16). */
export const ENCRYPTION_STREAM_OVERHEAD_BYTES = 1 + 12 + 16;

export type VerifiedAttachmentSize =
  | { ok: true; size: number }
  | { ok: false; status: number; error: string };

/**
 * Resolve authoritative file size from the `assets` bucket object for `filePath`.
 * Path must be owned by `userId` (`${userId}/...`). Rejects missing objects and
 * client under-reports (mismatch vs metadata, allowing known encryption overhead).
 */
export async function resolveVerifiedAttachmentSize(
  admin: SupabaseClient,
  userId: string,
  filePath: string,
  clientFileSize?: number | null
): Promise<VerifiedAttachmentSize> {
  if (!filePath || typeof filePath !== 'string') {
    return { ok: false, status: 400, error: 'Missing file path' };
  }

  const prefix = `${userId}/`;
  if (!filePath.startsWith(prefix) || filePath.includes('..') || filePath.includes('//')) {
    return { ok: false, status: 403, error: 'Invalid file path' };
  }

  const slash = filePath.lastIndexOf('/');
  if (slash <= 0 || slash === filePath.length - 1) {
    return { ok: false, status: 400, error: 'Invalid file path' };
  }

  const folder = filePath.slice(0, slash);
  const objectName = filePath.slice(slash + 1);

  const { data, error } = await admin.storage.from('assets').list(folder, {
    limit: 100,
    search: objectName,
  });

  if (error) {
    return { ok: false, status: 500, error: 'Failed to verify storage object' };
  }

  const obj = (data ?? []).find((entry) => entry.name === objectName);
  const metaSize = Number(obj?.metadata?.size);
  if (!obj || !Number.isFinite(metaSize) || metaSize < 0) {
    return { ok: false, status: 400, error: 'Storage object not found or size unavailable' };
  }

  if (clientFileSize != null && Number.isFinite(clientFileSize)) {
    const compatible =
      clientFileSize === metaSize ||
      clientFileSize + ENCRYPTION_STREAM_OVERHEAD_BYTES === metaSize;
    if (!compatible) {
      return { ok: false, status: 400, error: 'file_size does not match storage object' };
    }
  }

  // Prefer plaintext when client matched encryption-adjusted size; else metadata.
  const size =
    clientFileSize != null &&
    Number.isFinite(clientFileSize) &&
    clientFileSize + ENCRYPTION_STREAM_OVERHEAD_BYTES === metaSize
      ? clientFileSize
      : metaSize;

  return { ok: true, size };
}

export type FileMetadataInput = {
  path: string;
  fileName: string;
  fileType: string;
  fileSize?: number;
};

/**
 * Verify every fileMetadata entry and return rows ready for asset_attachments insert.
 */
export async function buildVerifiedAttachmentRows(
  admin: SupabaseClient,
  userId: string,
  assetId: string,
  fileMetadata: FileMetadataInput[]
): Promise<
  | {
      ok: true;
      rows: Array<{
        asset_id: string;
        file_path: string;
        file_name: string;
        file_type: string;
        file_size: number;
      }>;
      totalBytes: number;
    }
  | { ok: false; status: number; error: string }
> {
  const rows: Array<{
    asset_id: string;
    file_path: string;
    file_name: string;
    file_type: string;
    file_size: number;
  }> = [];
  let totalBytes = 0;

  for (const fm of fileMetadata) {
    const verified = await resolveVerifiedAttachmentSize(
      admin,
      userId,
      fm.path,
      fm.fileSize ?? null
    );
    if (!verified.ok) {
      return { ok: false, status: verified.status, error: verified.error };
    }
    totalBytes += verified.size;
    rows.push({
      asset_id: assetId,
      file_path: fm.path,
      file_name: fm.fileName,
      file_type: fm.fileType,
      file_size: verified.size,
    });
  }

  return { ok: true, rows, totalBytes };
}
