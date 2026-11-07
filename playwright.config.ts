import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";
import path from "node:path";
import { randomUUID } from "node:crypto";

dotenv.config({ path: ".env.local" });
dotenv.config();

const runId = process.env.PLAYWRIGHT_E2E_RUN_ID || `pw-${Date.now()}-${randomUUID().slice(0, 8)}`;
const manifestPath =
  process.env.PLAYWRIGHT_E2E_MANIFEST_PATH ||
  path.join(process.cwd(), "test-results", `e2e-run-manifest-${runId}.json`);
const customChromiumExecutablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

process.env.PLAYWRIGHT_E2E_RUN_ID = runId;
process.env.PLAYWRIGHT_E2E_MANIFEST_PATH = manifestPath;

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "*.spec.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  globalTeardown: "./e2e/global-teardown.ts",
  use: {
    baseURL: process.env.PLAYWRIGHT_TEST_BASE_URL || "http://localhost:3000",
    headless: process.env.PLAYWRIGHT_HEADFUL === "1" ? false : true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(customChromiumExecutablePath
          ? {
              launchOptions: {
                executablePath: customChromiumExecutablePath,
              },
            }
          : {}),
      },
    },
  ],

  /* Run your local dev server before starting the tests */
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 180 * 1000,
    env: {
      ...process.env,
      APP_TOKEN_SECRET:
        process.env.APP_TOKEN_SECRET ??
        "e2e-playwright-app-token-secret-minimum-32-characters",
    },
  },
});



