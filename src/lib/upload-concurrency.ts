export interface UploadResult<T> {
  file: File;
  ok: boolean;
  data?: T;
  error?: string;
}

/**
 * Upload files with a concurrency cap to avoid browser connection limits.
 */
export async function uploadWithConcurrency<T>(
  files: File[],
  uploadFn: (file: File) => Promise<T>,
  concurrency = 3
): Promise<UploadResult<T>[]> {
  const results: UploadResult<T>[] = new Array(files.length);
  let index = 0;

  async function worker() {
    while (index < files.length) {
      const current = index++;
      const file = files[current];
      try {
        const data = await uploadFn(file);
        results[current] = { file, ok: true, data };
      } catch (err) {
        results[current] = {
          file,
          ok: false,
          error: err instanceof Error ? err.message : 'Upload failed',
        };
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, files.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
