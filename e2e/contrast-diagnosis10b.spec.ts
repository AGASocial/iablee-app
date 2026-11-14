/**
 * DIAGNOSIS10B=1 PLAYWRIGHT_E2E_REAL_SUPABASE=1 PLAYWRIGHT_TEST_BASE_URL=http://localhost:3007 \
 *   npx playwright test e2e/contrast-diagnosis10b.spec.ts
 */
import { test, expect } from "./fixtures/test";
import { loginViaUi } from "./fixtures/ui";
import { auditUiBorders, setTheme, waitForVisualReady } from "./lib/contrast";
import fs from "fs";

const RUN = process.env.DIAGNOSIS10B === "1";

test.describe("border probe", () => {
  test.skip(!RUN, "DIAGNOSIS10B=1");

  test("dark auth register + settings borders", async ({ page, user }) => {
    const out: Record<string, unknown> = {};
    await setTheme(page, "dark");
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/es/auth/register", { waitUntil: "load" });
    await waitForVisualReady(page);
    // empty submit to match validation state
    await page.locator('button[type="submit"]').click().catch(() => undefined);
    await page.waitForTimeout(300);
    let borders = await auditUiBorders(page);
    out.register = borders.filter((b) => !b.pass || b.ratio < 3.5);
    out.registerAllButtons = borders.filter((b) => b.text.includes("button"));
    out.registerMin = Math.min(...borders.map((b) => b.ratio), 99);

    await loginViaUi(page, user, "en");
    await setTheme(page, "dark");
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/en/settings", { waitUntil: "load" });
    await waitForVisualReady(page);
    borders = await auditUiBorders(page);
    out.settings = borders.filter((b) => !b.pass || b.ratio < 3.5);
    out.settingsAll = borders;
    out.settingsMin = Math.min(...borders.map((b) => b.ratio), 99);

    fs.mkdirSync("/tmp/iablee-contrast3-shots/diagnosis", { recursive: true });
    fs.writeFileSync(
      "/tmp/iablee-contrast3-shots/diagnosis/border-probe-run10.json",
      JSON.stringify(out, null, 2),
    );
    console.log(JSON.stringify(out, null, 2));
    expect(out.registerMin, "register min ratio").toBeGreaterThanOrEqual(3.5);
    expect(out.settingsMin, "settings min ratio").toBeGreaterThanOrEqual(3.5);
  });
});
