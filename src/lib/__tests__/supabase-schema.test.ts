/**
 * @jest-environment node
 */
import {
  getSupabaseDbSchema,
  getStorageBucket,
  isNonPublicSchema,
} from '@/lib/supabase-schema';

describe('supabase-schema helpers', () => {
  const originalSchema = process.env.NEXT_PUBLIC_SUPABASE_DB_SCHEMA;
  const originalBucket = process.env.SUPABASE_STORAGE_BUCKET;

  afterEach(() => {
    if (originalSchema === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_DB_SCHEMA;
    else process.env.NEXT_PUBLIC_SUPABASE_DB_SCHEMA = originalSchema;
    if (originalBucket === undefined) delete process.env.SUPABASE_STORAGE_BUCKET;
    else process.env.SUPABASE_STORAGE_BUCKET = originalBucket;
  });

  describe('getSupabaseDbSchema', () => {
    it('defaults to public when unset', () => {
      delete process.env.NEXT_PUBLIC_SUPABASE_DB_SCHEMA;
      expect(getSupabaseDbSchema()).toBe('public');
    });

    it('defaults to public when empty/whitespace', () => {
      process.env.NEXT_PUBLIC_SUPABASE_DB_SCHEMA = '   ';
      expect(getSupabaseDbSchema()).toBe('public');
    });

    it('returns a valid configured schema', () => {
      process.env.NEXT_PUBLIC_SUPABASE_DB_SCHEMA = 'test_iablee';
      expect(getSupabaseDbSchema()).toBe('test_iablee');
    });

    it('throws on invalid schema (fail closed)', () => {
      process.env.NEXT_PUBLIC_SUPABASE_DB_SCHEMA = 'Test-Schema';
      expect(() => getSupabaseDbSchema()).toThrow(/Invalid NEXT_PUBLIC_SUPABASE_DB_SCHEMA/);
    });

    it('throws on schema starting with a digit', () => {
      process.env.NEXT_PUBLIC_SUPABASE_DB_SCHEMA = '1bad';
      expect(() => getSupabaseDbSchema()).toThrow(/Invalid NEXT_PUBLIC_SUPABASE_DB_SCHEMA/);
    });
  });

  describe('isNonPublicSchema', () => {
    it('is false for public / unset', () => {
      delete process.env.NEXT_PUBLIC_SUPABASE_DB_SCHEMA;
      expect(isNonPublicSchema()).toBe(false);
    });

    it('is true for a non-public schema', () => {
      process.env.NEXT_PUBLIC_SUPABASE_DB_SCHEMA = 'test_iablee';
      expect(isNonPublicSchema()).toBe(true);
    });
  });

  describe('getStorageBucket', () => {
    it('defaults to assets when unset', () => {
      delete process.env.SUPABASE_STORAGE_BUCKET;
      expect(getStorageBucket()).toBe('assets');
    });

    it('returns a valid configured bucket', () => {
      process.env.SUPABASE_STORAGE_BUCKET = 'test-assets';
      expect(getStorageBucket()).toBe('test-assets');
    });

    it('throws on invalid bucket (fail closed)', () => {
      process.env.SUPABASE_STORAGE_BUCKET = 'Bad Bucket!';
      expect(() => getStorageBucket()).toThrow(/Invalid SUPABASE_STORAGE_BUCKET/);
    });
  });
});
