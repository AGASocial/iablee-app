/**
 * @jest-environment node
 */
import { uploadWithConcurrency } from '@/lib/upload-concurrency';

describe('uploadWithConcurrency', () => {
  it('uploads files with concurrency cap and per-file error handling', async () => {
    const files = [
      new File(['a'], 'a.txt'),
      new File(['b'], 'b.txt'),
      new File(['c'], 'c.txt'),
    ];

    let concurrent = 0;
    let maxConcurrent = 0;

    const results = await uploadWithConcurrency(
      files,
      async (file) => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((r) => setTimeout(r, 20));
        concurrent--;
        if (file.name === 'b.txt') throw new Error('fail');
        return { path: `/uploads/${file.name}` };
      },
      2
    );

    expect(maxConcurrent).toBeLessThanOrEqual(2);
    expect(results.filter((r) => r.ok)).toHaveLength(2);
    expect(results.find((r) => r.file.name === 'b.txt')?.ok).toBe(false);
  });
});
