const DB_SCHEMA_RE = /^[a-z_][a-z0-9_]{0,62}$/;
const STORAGE_BUCKET_RE = /^[a-z0-9][a-z0-9_-]{0,62}$/;

/**
 * Postgres schema for PostgREST / supabase-js.
 * Must reference NEXT_PUBLIC_SUPABASE_DB_SCHEMA literally so Next.js inlines it for the browser client.
 * Defaults to `public` when unset. Invalid values fail closed (throw).
 */
export function getSupabaseDbSchema(): string {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_DB_SCHEMA;
  const schema = raw?.trim() || 'public';
  if (!DB_SCHEMA_RE.test(schema)) {
    throw new Error(
      `Invalid NEXT_PUBLIC_SUPABASE_DB_SCHEMA "${schema}": must match ${DB_SCHEMA_RE}`
    );
  }
  return schema;
}

export function isNonPublicSchema(): boolean {
  return getSupabaseDbSchema() !== 'public';
}

/**
 * Server-only storage bucket name. Defaults to `assets` when unset.
 * Invalid values fail closed (throw).
 */
export function getStorageBucket(): string {
  const raw = process.env.SUPABASE_STORAGE_BUCKET;
  const bucket = raw?.trim() || 'assets';
  if (!STORAGE_BUCKET_RE.test(bucket)) {
    throw new Error(
      `Invalid SUPABASE_STORAGE_BUCKET "${bucket}": must match ${STORAGE_BUCKET_RE}`
    );
  }
  return bucket;
}

/** Options for createClient / createServerClient / createBrowserClient. Cast keeps Database<'public'> typings. */
export function getSupabaseClientDbOption(): { schema: 'public' } {
  return { schema: getSupabaseDbSchema() as 'public' };
}
