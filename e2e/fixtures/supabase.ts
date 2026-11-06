import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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
const E2E_EMAIL_SWEEP_REGEX = /^e2e-.*@iablee\.test$/i;
const ASSETS_BUCKET = "assets";

let adminClient: SupabaseClient | null = null;

function requireEnv(name: "NEXT_PUBLIC_SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY"): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function getSupabaseAdmin(): SupabaseClient {
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

function buildUserIdentity(): { email: string; password: string; fullName: string } {
  const now = Date.now();
  const email = `e2e-${now}-${randomSuffix()}@iablee.test`;
  const password = `E2E!${randomSuffix(10)}${Date.now().toString().slice(-4)}`;
  const fullName = `E2E User ${randomSuffix(4)}`;
  return { email, password, fullName };
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
  const admin = getSupabaseAdmin();
  const identity = buildUserIdentity();

  const { data, error } = await admin.auth.admin.createUser({
    email: identity.email,
    password: identity.password,
    email_confirm: true,
    user_metadata: { full_name: identity.fullName },
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
      continue;
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
    await admin.storage.from(ASSETS_BUCKET).remove(chunk);
  }
}

async function safeDeleteByUserId(table: string, userId: string): Promise<void> {
  const admin = getSupabaseAdmin();
  await admin.from(table).delete().eq("user_id", userId);
}

export async function cleanupUserData(userId: string): Promise<void> {
  const admin = getSupabaseAdmin();

  const { data: assets } = await admin
    .from("digital_assets")
    .select("id, files")
    .eq("user_id", userId);

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
    const { data: attachments } = await admin
      .from("asset_attachments")
      .select("id, file_path")
      .in("asset_id", assetIds);

    const attachmentPaths = (attachments ?? [])
      .map((attachment) => attachment.file_path as string)
      .filter(Boolean);

    await removeStorageFilesForUser(userId, [...filePathsFromJson, ...attachmentPaths]);
    await admin.from("asset_attachments").delete().in("asset_id", assetIds);
  } else {
    await removeStorageFilesForUser(userId, filePathsFromJson);
  }

  const { data: beneficiaries } = await admin
    .from("beneficiaries")
    .select("id")
    .eq("user_id", userId);

  const beneficiaryIds = (beneficiaries ?? []).map((beneficiary) => beneficiary.id as string).filter(Boolean);
  if (beneficiaryIds.length > 0) {
    await admin
      .from("beneficiary_email_verifications")
      .delete()
      .in("beneficiary_id", beneficiaryIds);
  }

  await safeDeleteByUserId("wizard_completion_idempotency", userId);
  await safeDeleteByUserId("billing_invoices", userId);
  await safeDeleteByUserId("billing_payment_methods", userId);
  await safeDeleteByUserId("billing_subscriptions", userId);
  await safeDeleteByUserId("security_otps", userId);
  await safeDeleteByUserId("digital_assets", userId);
  await safeDeleteByUserId("beneficiaries", userId);
  await admin.from("users").delete().eq("id", userId);
  await admin.auth.admin.deleteUser(userId);
}

export async function sweepAllE2EUsers(): Promise<void> {
  const admin = getSupabaseAdmin();
  let page = 1;
  const perPage = 200;

  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage,
    });

    if (error) {
      throw new Error(`Failed listing users for sweep: ${error.message}`);
    }

    const users = data.users ?? [];
    const targetUsers = users.filter((user) => {
      const email = user.email ?? "";
      return E2E_EMAIL_SWEEP_REGEX.test(email);
    });

    for (const user of targetUsers) {
      await cleanupUserData(user.id);
    }

    if (users.length < perPage) {
      break;
    }
    page += 1;
  }
}

export function assertE2EEmail(email: string): void {
  if (!E2E_EMAIL_REGEX.test(email)) {
    throw new Error(`Refusing to clean non-e2e email user: ${email}`);
  }
}
