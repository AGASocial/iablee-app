/**
 * One-off dark/es/desktop showcase shots for KAN-146.
 * Skips unless CONTRAST_SHOWCASE=1.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { expect, test } from "./fixtures/test";
import { createPinFromSecurityPage, loginViaUi } from "./fixtures/ui";
import {
  hideDevOverlaysForScreenshot,
  setTheme,
  waitForVisualReady,
} from "./lib/contrast";
import { PIN } from "./lib/contrast-audit-runner";

const OUT = "/tmp/iablee-contrast3-shots/showcase";

test("dark es desktop showcase after shots", async ({ page, user }) => {
  test.skip(process.env.CONTRAST_SHOWCASE !== "1", "Set CONTRAST_SHOWCASE=1");
  test.setTimeout(180_000);
  await fs.mkdir(OUT, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 800 });

  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));
  page.on("console", (msg) => {
    if (msg.type() === "error") pageErrors.push(`console: ${msg.text()}`);
  });

  // Public register (no auth) — also probe for real Next.js issues
  await page.goto("/es/auth/register", { waitUntil: "domcontentloaded" });
  await setTheme(page, "dark");
  await waitForVisualReady(page);
  await hideDevOverlaysForScreenshot(page);
  // Capture any Next issue badge text before hide (already removed); dump pageErrors
  await page.screenshot({
    path: path.join(OUT, "dark-register-after.png"),
    fullPage: true,
  });
  await fs.writeFile(
    path.join(OUT, "register-page-errors.json"),
    JSON.stringify({ route: "/es/auth/register", errors: pageErrors }, null, 2),
  );

  await loginViaUi(page, user, "es");
  await createPinFromSecurityPage(page, PIN);

  for (const [route, file] of [
    ["/es/settings", "dark-settings-after.png"],
    ["/es/dashboard", "dark-dashboard-after.png"],
  ] as const) {
    await page.goto(route, { waitUntil: "domcontentloaded" });
    await setTheme(page, "dark");
    await waitForVisualReady(page);
    await hideDevOverlaysForScreenshot(page);
    await expect(page.locator("body")).toBeVisible();
    await page.screenshot({ path: path.join(OUT, file), fullPage: true });
  }
});
