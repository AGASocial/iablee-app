import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import fs from "node:fs/promises";
import path from "node:path";

export type E2EUser = {
  id: string;
  email: string;
  password: string;
  fullName: string;
};

export type UserPinState = {
  hasPin: boolean;
  failedAttempts: number;
  lockedUntil: string | null;
};

const E2E_EMAIL_REGEX = /^e2e-[a-z0-9-]+@iablee\.test$/i;
const ASSETS_BUCKET = "assets";
const ALLOWLISTED_SUPABASE_PROJECT_REF = "lrnhrzpwgyhkruwxeppw";
const LOCAL_HOST_ALLOWLIST = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);
const REQUIRED_REAL_SUPABASE_OPT_IN = "PLAYWRIGHT_E2E_REAL_SUPABASE";

type RunManifestEntry = { userId: string; email: string };
type RunManifest = {
  runId: string;
  createdAt: string;
  users: RunManifestEntry[];
};

let adminClient: SupabaseClient | null = null;
let validatedEnvironment = false;
let manifestQueue: Promise<void> = Promise.resolve();

const RUN_ID = process.env.PLAYWRIGHT_E2E_RUN_ID ?? `local-${Date.now()}-${randomSuffix(8)}`;
const MANIFEST_PATH =
  process.env.PLAYWRIGHT_E2E_MANIFEST_PATH ??
  path.join(process.cwd(), "test-results", `e2e-run-manifest-${RUN_ID}.json`);

process.env.PLAYWRIGHT_E2E_RUN_ID = RUN_ID;
process.env.PLAYWRIGHT_E2E_MANIFEST_PATH = MANIFEST_PATH;

function requireEnv(name: "NEXT_PUBLIC_SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY"): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function getSupabaseAdmin(): SupabaseClient {
  ensureSafeE2EEnvironment();

  if (adminClient) {
    return adminClient;
  }

  adminClient = createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );

  return adminClient;
}

function randomSuffix(length = 6): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

/** Guaranteed policy-compliant password: upper, lower, digit, special, len>=10, no 4-run seq/repeat. */
function buildCompliantPassword(): string {
  // Separators break any accidental sequential/repeated runs in the random parts.
  const a = randomSuffix(3);
  const b = randomSuffix(3);
  const c = randomSuffix(3);
  return `Tp9!${a}-${b}_${c}`;
}

function buildUserIdentity(): { email: string; password: string; fullName: string } {
  const now = Date.now();
  const email = `e2e-${now}-${randomSuffix()}@iablee.test`;
  const password = buildCompliantPassword();
  const fullName = `E2E User ${randomSuffix(4)}`;
  return { email, password, fullName };
}

function ensureSafeE2EEnvironment(): void {
  if (validatedEnvironment) {
    return;
  }

  if (process.env[REQUIRED_REAL_SUPABASE_OPT_IN] !== "1") {
    throw new Error(
      `Refusing service-role actions without explicit opt-in. Set ${REQUIRED_REAL_SUPABASE_OPT_IN}=1 for this run.`,
    );
  }

  const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const baseUrl = process.env.PLAYWRIGHT_TEST_BASE_URL || "http://localhost:3000";

  let parsedSupabaseUrl: URL;
  try {
    parsedSupabaseUrl = new URL(supabaseUrl);
  } catch {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is not a valid URL");
  }

  const expectedHost = `${ALLOWLISTED_SUPABASE_PROJECT_REF}.supabase.co`;
  if (parsedSupabaseUrl.hostname !== expectedHost) {
    throw new Error(
      `Refusing service-role actions for Supabase project "${parsedSupabaseUrl.hostname}". Expected "${expectedHost}".`,
    );
  }

  let parsedBaseUrl: URL;
  try {
    parsedBaseUrl = new URL(baseUrl);
  } catch {
    throw new Error(`PLAYWRIGHT_TEST_BASE_URL is not a valid URL: ${baseUrl}`);
  }

  if (!LOCAL_HOST_ALLOWLIST.has(parsedBaseUrl.hostname)) {
    throw new Error(
      `Refusing service-role actions because PLAYWRIGHT_TEST_BASE_URL is not local: ${baseUrl}`,
    );
  }

  validatedEnvironment = true;
}

function createDefaultManifest(): RunManifest {
  return {
    runId: RUN_ID,
    createdAt: new Date().toISOString(),
    users: [],
  };
}

async function readManifest(): Promise<RunManifest> {
  try {
    const raw = await fs.readFile(MANIFEST_PATH, "utf-8");
    const parsed = JSON.parse(raw) as Partial<RunManifest>;
    if (parsed.runId !== RUN_ID || !Array.isArray(parsed.users)) {
      return createDefaultManifest();
    }

    return {
      runId: parsed.runId,
      createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : new Date().toISOString(),
      users: parsed.users
        .filter((entry): entry is RunManifestEntry => {
          return (
            !!entry &&
            typeof entry === "object" &&
            typeof (entry as RunManifestEntry).userId === "string" &&
            typeof (entry as RunManifestEntry).email === "string"
          );
        })
        .map((entry) => ({ userId: entry.userId, email: entry.email })),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return createDefaultManifest();
    }
    throw new Error(`Failed to read run manifest at ${MANIFEST_PATH}: ${(error as Error).message}`);
  }
}

async function writeManifest(manifest: RunManifest): Promise<void> {
  const dir = path.dirname(MANIFEST_PATH);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
}

async function withManifestMutation(mutator: (manifest: RunManifest) => Promise<void> | void): Promise<void> {
  manifestQueue = manifestQueue.then(async () => {
    const manifest = await readManifest();
    await mutator(manifest);
    await writeManifest(manifest);
  });

  return manifestQueue;
}

async function addUserToManifest(entry: RunManifestEntry): Promise<void> {
  await withManifestMutation((manifest) => {
    if (!manifest.users.some((current) => current.userId === entry.userId)) {
      manifest.users.push(entry);
    }
  });
}

async function removeUserFromManifest(userId: string): Promise<void> {
  await withManifestMutation((manifest) => {
    manifest.users = manifest.users.filter((entry) => entry.userId !== userId);
  });
}

function extractRunIdFromUser(user: { user_metadata?: Record<string, unknown> } | null): string | null {
  const value = user?.user_metadata?.e2e_run_id;
  return typeof value === "string" ? value : null;
}

async function ensurePublicUserRow(user: E2EUser): Promise<void> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("users")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed reading users row for ${user.id}: ${error.message}`);
  }

  if (!data) {
    const { error: insertError } = await admin.from("users").insert({
      id: user.id,
      email: user.email,
      full_name: user.fullName,
    });
    if (insertError) {
      throw new Error(`Failed creating users row for ${user.id}: ${insertError.message}`);
    }
  }
}

export async function createThrowawayUser(): Promise<E2EUser> {
  ensureSafeE2EEnvironment();
  const admin = getSupabaseAdmin();
  const identity = buildUserIdentity();

  const { data, error } = await admin.auth.admin.createUser({
    email: identity.email,
    password: identity.password,
    email_confirm: true,
    user_metadata: {
      full_name: identity.fullName,
      e2e_run_id: RUN_ID,
      e2e_manifest_path: MANIFEST_PATH,
    },
  });

  if (error || !data.user) {
    throw new Error(`Failed creating test user: ${error?.message ?? "unknown error"}`);
  }

  const user: E2EUser = {
    id: data.user.id,
    email: identity.email,
    password: identity.password,
    fullName: identity.fullName,
  };

  await ensurePublicUserRow(user);
  await addUserToManifest({ userId: user.id, email: user.email });
  return user;
}

export async function getUserPinState(userId: string): Promise<UserPinState> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("users")
    .select("security_pin_hash,pin_failed_attempts,pin_locked_until")
    .eq("id", userId)
    .single();

  if (error || !data) {
    throw new Error(`Failed loading pin state for ${userId}: ${error?.message ?? "missing user row"}`);
  }

  return {
    hasPin: typeof data.security_pin_hash === "string" && data.security_pin_hash.length > 0,
    failedAttempts: typeof data.pin_failed_attempts === "number" ? data.pin_failed_attempts : 0,
    lockedUntil: typeof data.pin_locked_until === "string" ? data.pin_locked_until : null,
  };
}

async function listStorageObjectsRecursively(prefix: string): Promise<string[]> {
  const admin = getSupabaseAdmin();
  const toVisit: string[] = [prefix];
  const objectPaths = new Set<string>();

  while (toVisit.length > 0) {
    const currentPrefix = toVisit.pop();
    if (!currentPrefix) continue;

    const { data, error } = await admin.storage.from(ASSETS_BUCKET).list(currentPrefix, {
      limit: 1000,
      offset: 0,
      sortBy: { column: "name", order: "asc" },
    });

    if (error) {
      throw new Error(`Failed listing storage objects for prefix "${currentPrefix}": ${error.message}`);
    }

    for (const entry of data ?? []) {
      const nextPath = `${currentPrefix}/${entry.name}`.replace(/^\/+/, "");
      // Supabase lists folders with id = null.
      if (entry.id === null) {
        toVisit.push(nextPath);
      } else {
        objectPaths.add(nextPath);
      }
    }
  }

  return Array.from(objectPaths);
}

async function removeStorageFilesForUser(userId: string, extraPaths: string[] = []): Promise<void> {
  const admin = getSupabaseAdmin();
  const listed = await listStorageObjectsRecursively(userId);
  const deduped = Array.from(new Set([...listed, ...extraPaths].filter(Boolean)));
  if (deduped.length === 0) return;

  const chunkSize = 100;
  for (let i = 0; i < deduped.length; i += chunkSize) {
    const chunk = deduped.slice(i, i + chunkSize);
    const { error } = await admin.storage.from(ASSETS_BUCKET).remove(chunk);
    if (error) {
      throw new Error(`Failed removing storage objects for user ${userId}: ${error.message}`);
    }
  }
}

async function safeDeleteByUserId(table: string, userId: string): Promise<void> {
  const admin = getSupabaseAdmin();
  const { error } = await admin.from(table).delete().eq("user_id", userId);
  if (error) {
    throw new Error(`Failed deleting user-scoped rows from ${table} for ${userId}: ${error.message}`);
  }
}

async function assertRunOwnedCleanupTarget(userId: string): Promise<RunManifestEntry> {
  const manifest = await readManifest();
  const manifestEntry = manifest.users.find((entry) => entry.userId === userId);
  if (!manifestEntry) {
    throw new Error(
      `Refusing cleanup for user ${userId} because manifest ownership is missing for run ${RUN_ID}.`,
    );
  }

  const admin = getSupabaseAdmin();
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error) {
    throw new Error(`Failed loading auth user ${userId} before cleanup: ${error.message}`);
  }

  const authUser = data.user;
  if (!authUser) {
    throw new Error(`Refusing cleanup for user ${userId} because Auth user does not exist.`);
  }

  const authEmail = authUser.email ?? "";
  assertE2EEmail(authEmail);
  if (authEmail.toLowerCase() !== manifestEntry.email.toLowerCase()) {
    throw new Error(
      `Refusing cleanup for user ${userId} because manifest email does not match Auth email.`,
    );
  }

  const runId = extractRunIdFromUser(authUser);
  if (runId !== RUN_ID) {
    throw new Error(
      `Refusing cleanup for user ${userId} because run ownership does not match. Expected ${RUN_ID}, got ${runId ?? "none"}.`,
    );
  }

  return manifestEntry;
}

export async function cleanupUserData(userId: string): Promise<void> {
  ensureSafeE2EEnvironment();
  await assertRunOwnedCleanupTarget(userId);
  const admin = getSupabaseAdmin();

  const { data: assets, error: assetsError } = await admin
    .from("digital_assets")
    .select("id, files")
    .eq("user_id", userId);
  if (assetsError) {
    throw new Error(`Failed loading digital_assets for ${userId}: ${assetsError.message}`);
  }

  const assetIds = (assets ?? []).map((asset) => asset.id as string).filter(Boolean);
  const filePathsFromJson: string[] = [];

  for (const asset of assets ?? []) {
    const files = asset.files;
    if (Array.isArray(files)) {
      for (const filePath of files) {
        if (typeof filePath === "string") {
          filePathsFromJson.push(filePath);
        }
      }
    }
  }

  if (assetIds.length > 0) {
    const { data: attachments, error: attachmentsError } = await admin
      .from("asset_attachments")
      .select("id, file_path")
      .in("asset_id", assetIds);
    if (attachmentsError) {
      throw new Error(`Failed loading asset_attachments for ${userId}: ${attachmentsError.message}`);
    }

    const attachmentPaths = (attachments ?? [])
      .map((attachment) => attachment.file_path as string)
      .filter(Boolean);

    await removeStorageFilesForUser(userId, [...filePathsFromJson, ...attachmentPaths]);
    const { error: deleteAttachmentsError } = await admin
      .from("asset_attachments")
      .delete()
      .in("asset_id", assetIds);
    if (deleteAttachmentsError) {
      throw new Error(
        `Failed deleting asset_attachments for ${userId}: ${deleteAttachmentsError.message}`,
      );
    }
  } else {
    await removeStorageFilesForUser(userId, filePathsFromJson);
  }

  const { data: beneficiaries, error: beneficiariesError } = await admin
    .from("beneficiaries")
    .select("id")
    .eq("user_id", userId);
  if (beneficiariesError) {
    throw new Error(`Failed loading beneficiaries for ${userId}: ${beneficiariesError.message}`);
  }

  const beneficiaryIds = (beneficiaries ?? []).map((beneficiary) => beneficiary.id as string).filter(Boolean);
  if (beneficiaryIds.length > 0) {
    const { error } = await admin
      .from("beneficiary_email_verifications")
      .delete()
      .in("beneficiary_id", beneficiaryIds);
    if (error) {
      throw new Error(`Failed deleting beneficiary verifications for ${userId}: ${error.message}`);
    }
  }

  await safeDeleteByUserId("wizard_completion_idempotency", userId);
  await safeDeleteByUserId("billing_invoices", userId);
  await safeDeleteByUserId("billing_payment_methods", userId);
  await safeDeleteByUserId("billing_subscriptions", userId);
  await safeDeleteByUserId("security_otps", userId);
  await safeDeleteByUserId("digital_assets", userId);
  await safeDeleteByUserId("beneficiaries", userId);
  const { error: deleteUserRowError } = await admin.from("users").delete().eq("id", userId);
  if (deleteUserRowError) {
    throw new Error(`Failed deleting users row for ${userId}: ${deleteUserRowError.message}`);
  }

  const { error: deleteAuthUserError } = await admin.auth.admin.deleteUser(userId);
  if (deleteAuthUserError) {
    throw new Error(`Failed deleting auth user ${userId}: ${deleteAuthUserError.message}`);
  }

  await removeUserFromManifest(userId);
}

export async function cleanupRunOwnedUsersFromManifest(): Promise<void> {
  ensureSafeE2EEnvironment();
  const manifest = await readManifest();
  if (manifest.users.length === 0) {
    return;
  }

  const errors: string[] = [];
  for (const entry of manifest.users) {
    try {
      await cleanupUserData(entry.userId);
    } catch (error) {
      errors.push(`${entry.userId} (${entry.email}): ${(error as Error).message}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Run cleanup had ${errors.length} failure(s): ${errors.join(" | ")}`);
  }
}

export async function verifyNoRunOwnedUsersRemain(): Promise<void> {
  ensureSafeE2EEnvironment();
  const admin = getSupabaseAdmin();
  let page = 1;
  const perPage = 200;
  const leftovers: string[] = [];

  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage,
    });

    if (error) {
      throw new Error(`Failed listing users for run verification: ${error.message}`);
    }

    const users = data.users ?? [];
    for (const user of users) {
      const email = user.email ?? "";
      if (!E2E_EMAIL_REGEX.test(email)) {
        continue;
      }

      const runId = extractRunIdFromUser(user);
      if (runId === RUN_ID) {
        leftovers.push(`${user.id}:${email}`);
      }
    }

    if (users.length < perPage) {
      break;
    }
    page += 1;
  }

  if (leftovers.length > 0) {
    throw new Error(
      `Run-owned users still exist after cleanup for run ${RUN_ID}: ${leftovers.join(", ")}`,
    );
  }
}

export function assertE2EEmail(email: string): void {
  if (!E2E_EMAIL_REGEX.test(email)) {
    throw new Error(`Refusing to clean non-e2e email user: ${email}`);
  }
}
