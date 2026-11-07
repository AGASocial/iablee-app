import { cleanupRunOwnedUsersFromManifest, verifyNoRunOwnedUsersRemain } from "./fixtures/supabase";

async function globalTeardown(): Promise<void> {
  await cleanupRunOwnedUsersFromManifest();
  await verifyNoRunOwnedUsersRemain();
}

export default globalTeardown;
