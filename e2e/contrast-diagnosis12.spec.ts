/**
 * One-off header layout + ratio probe for KAN-146 run #12.
 * Skips unless CONTRAST_DIAGNOSIS=1.
 */
import fs from "node:fs/promises";
import { expect, test } from "./fixtures/test";
import { createPinFromSecurityPage, loginViaUi } from "./fixtures/ui";
import {
  assertPageTitleLayout,
  sampleContrast,
  setTheme,
  waitForVisualReady,
} from "./lib/contrast";
import { PIN } from "./lib/contrast-audit-runner";

const OUT = "/tmp/iablee-contrast3-shots/diagnosis/header-probe-run12.json";

const ROUTES = [
  "/es/dashboard",
  "/es/settings",
  "/es/settings/preferences",
  "/es/settings/security",
  "/es/beneficiaries",
  "/es/digital-assets",
  "/es/billing",
  "/es/billing/plans",
  "/es/my-beneficiary-relationships",
] as const;

test("probe page-title layout + contrast ratios", async ({ page, user }) => {
  test.skip(process.env.CONTRAST_DIAGNOSIS !== "1", "Set CONTRAST_DIAGNOSIS=1");
  test.setTimeout(300_000);

  await loginViaUi(page, user, "es");
  await createPinFromSecurityPage(page, PIN);

  const rows: unknown[] = [];
  for (const theme of ["light", "dark"] as const) {
    for (const viewport of [
      { name: "desktop", width: 1280, height: 800 },
      { name: "mobile", width: 375, height: 812 },
    ] as const) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      for (const route of ROUTES) {
        await page.goto(route, { waitUntil: "domcontentloaded" });
        await setTheme(page, theme);
        await waitForVisualReady(page);
        let layoutError: string | null = null;
        try {
          await assertPageTitleLayout(page, `${route} ${theme} ${viewport.name}`);
        } catch (e) {
          layoutError = e instanceof Error ? e.message : String(e);
        }
        const title = await sampleContrast(page, "main .page-title", { forcePixel: true });
        const subtitle = await sampleContrast(page, "main .page-subtitle", {
          forcePixel: true,
        });
        // Also grab EN once for dashboard
        rows.push({
          route,
          theme,
          viewport: viewport.name,
          layoutError,
          title: title
            ? {
                text: title.text,
                ratio: title.ratio,
                required: title.required,
                pass: title.pass,
                fg: title.color,
                bg: title.bg,
              }
            : null,
          subtitle: subtitle
            ? {
                text: subtitle.text,
                ratio: subtitle.ratio,
                required: subtitle.required,
                pass: subtitle.pass,
                fg: subtitle.color,
                bg: subtitle.bg,
              }
            : null,
        });
      }
    }
  }

  // English desktop dark sample
  await page.setViewportSize({ width: 1280, height: 800 });
  for (const route of ["/en/dashboard", "/en/settings"] as const) {
    await page.goto(route, { waitUntil: "domcontentloaded" });
    await setTheme(page, "dark");
    await waitForVisualReady(page);
    await assertPageTitleLayout(page, `${route} dark desktop`);
    const title = await sampleContrast(page, "main .page-title", { forcePixel: true });
    rows.push({
      route,
      theme: "dark",
      viewport: "desktop",
      layoutError: null,
      title: title
        ? { text: title.text, ratio: title.ratio, required: title.required, pass: title.pass }
        : null,
    });
  }

  await fs.writeFile(OUT, JSON.stringify(rows, null, 2));
  const fails = rows.filter(
    (r) =>
      (r as { layoutError: string | null }).layoutError ||
      (r as { title?: { pass?: boolean } }).title?.pass === false ||
      (r as { subtitle?: { pass?: boolean } }).subtitle?.pass === false,
  );
  expect(fails, JSON.stringify(fails, null, 2)).toEqual([]);
});
