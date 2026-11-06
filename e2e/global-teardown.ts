import { sweepAllE2EUsers } from "./fixtures/supabase";

async function globalTeardown(): Promise<void> {
  await sweepAllE2EUsers();
}

export default globalTeardown;
