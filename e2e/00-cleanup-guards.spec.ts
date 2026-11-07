import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { expect, test } from "@playwright/test";
import {
  cleanupRunOwnedUsersFromManifest,
  cleanupUserData,
  createThrowawayUser,
  getSupabaseAdmin,
} from "./fixtures/supabase";

type RunManifestEntry = { userId: string; email: string };
type RunManifest = {
  runId: string;
  createdAt: string;
  users: RunManifestEntry[];
};

function getManifestPath(): string {
  const manifestPath = process.env.PLAYWRIGHT_E2E_MANIFEST_PATH;
  if (!manifestPath) {
    throw new Error("PLAYWRIGHT_E2E_MANIFEST_PATH is required for cleanup guard tests");
  }
  return manifestPath;
}

function getRunId(): string {
  const runId = process.env.PLAYWRIGHT_E2E_RUN_ID;
  if (!runId) {
    throw new Error("PLAYWRIGHT_E2E_RUN_ID is required for cleanup guard tests");
  }
  return runId;
}

async function readManifest(): Promise<RunManifest> {
  const manifestPath = getManifestPath();
  try {
    const content = await fs.readFile(manifestPath, "utf-8");
    const parsed = JSON.parse(content) as RunManifest;
    if (!parsed || !Array.isArray(parsed.users)) {
      return { runId: getRunId(), createdAt: new Date().toISOString(), users: [] };
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { runId: getRunId(), createdAt: new Date().toISOString(), users: [] };
    }
    throw error;
  }
}

async function writeManifest(manifest: RunManifest): Promise<void> {
  await fs.writeFile(getManifestPath(), `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
}

async function upsertManifestEntry(entry: RunManifestEntry): Promise<void> {
  const manifest = await readManifest();
  const index = manifest.users.findIndex((current) => current.userId === entry.userId);
  if (index >= 0) {
    manifest.users[index] = entry;
  } else {
    manifest.users.push(entry);
  }
  await writeManifest(manifest);
}

async function removeManifestEntry(userId: string): Promise<void> {
  const manifest = await readManifest();
  manifest.users = manifest.users.filter((entry) => entry.userId !== userId);
  await writeManifest(manifest);
}

test.describe("00 cleanup guards", () => {
  test("fails closed when Auth user is missing before cleanup", async () => {
    const admin = getSupabaseAdmin();
    const user = await createThrowawayUser();

    try {
      const { error: deleteAuthError } = await admin.auth.admin.deleteUser(user.id);
      if (deleteAuthError) {
        throw new Error(`Unable to prepare missing-auth scenario: ${deleteAuthError.message}`);
      }

      await expect(cleanupUserData(user.id)).rejects.toThrow(/(Auth user does not exist|User not found)/);

      const { data: userRow, error: rowError } = await admin.from("users").select("id").eq("id", user.id).maybeSingle();
      expect(rowError).toBeNull();
      expect(userRow?.id).toBe(user.id);
    } finally {
      await removeManifestEntry(user.id);
      await admin.from("users").delete().eq("id", user.id);
    }
  });

  test("fails closed when run ownership is foreign", async () => {
    const admin = getSupabaseAdmin();
    const email = `e2e-${Date.now()}-foreign@iablee.test`;
    const password = `E2E!${randomUUID().replace(/-/g, "").slice(0, 12)}9`;
    const fullName = "E2E Foreign Run";
    const foreignRunId = `foreign-${Date.now()}`;

    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
        e2e_run_id: foreignRunId,
      },
    });
    if (error || !data.user) {
      throw new Error(`Unable to create foreign-run user: ${error?.message ?? "unknown error"}`);
    }
    const userId = data.user.id;

    await admin.from("users").insert({ id: userId, email, full_name: fullName });
    await upsertManifestEntry({ userId, email });

    try {
      await expect(cleanupUserData(userId)).rejects.toThrow(/run ownership does not match/);

      const { data: authData, error: authError } = await admin.auth.admin.getUserById(userId);
      expect(authError).toBeNull();
      expect(authData.user?.id).toBe(userId);

      const { data: userRow, error: rowError } = await admin.from("users").select("id").eq("id", userId).maybeSingle();
      expect(rowError).toBeNull();
      expect(userRow?.id).toBe(userId);
    } finally {
      await removeManifestEntry(userId);
      await admin.from("users").delete().eq("id", userId);
      await admin.auth.admin.deleteUser(userId);
    }
  });

  test("fails closed when manifest registry is altered/stale", async () => {
    const admin = getSupabaseAdmin();
    const user = await createThrowawayUser();
    const objectName = `cleanup-guard-${Date.now()}.txt`;
    const objectPath = `${user.id}/${objectName}`;

    const { error: uploadError } = await admin.storage
      .from("assets")
      .upload(objectPath, Buffer.from("guard-check"), { contentType: "text/plain", upsert: true });
    if (uploadError) {
      throw new Error(`Unable to prepare storage object for guard test: ${uploadError.message}`);
    }

    try {
      await upsertManifestEntry({ userId: user.id, email: `e2e-${Date.now()}-mismatch@iablee.test` });
      await expect(cleanupRunOwnedUsersFromManifest()).rejects.toThrow(/manifest email does not match Auth email/);

      const { data: authData, error: authError } = await admin.auth.admin.getUserById(user.id);
      expect(authError).toBeNull();
      expect(authData.user?.id).toBe(user.id);

      const { data: rows, error: rowError } = await admin.from("users").select("id").eq("id", user.id);
      expect(rowError).toBeNull();
      expect(rows?.some((row) => row.id === user.id)).toBe(true);

      const { data: filesAfterFailure, error: listError } = await admin.storage.from("assets").list(user.id);
      expect(listError).toBeNull();
      expect((filesAfterFailure ?? []).some((file) => file.name === objectName)).toBe(true);
    } finally {
      await upsertManifestEntry({ userId: user.id, email: user.email });
      await cleanupUserData(user.id);
    }
  });
});
