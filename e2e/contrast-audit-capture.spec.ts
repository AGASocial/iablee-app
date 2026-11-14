/**
 * One-off contrast capture/audit. Run with:
 * CONTRAST_AUDIT_PHASE=before|after PLAYWRIGHT_E2E_REAL_SUPABASE=1 \
 * PLAYWRIGHT_TEST_BASE_URL=http://localhost:3005 npx playwright test e2e/contrast-audit-capture.spec.ts
 */
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs/promises";
import path from "node:path";
import { expect, test } from "./fixtures/test";
import { createPinFromSecurityPage, loginViaUi } from "./fixtures/ui";
import { sampleContrast, setTheme } from "./lib/contrast";

const PHASE = process.env.CONTRAST_AUDIT_PHASE || "before";
const OUT_ROOT = "/tmp/iablee-contrast2-screenshots";
const OUT_DIR = path.join(OUT_ROOT, PHASE);
const REPORT_PATH = path.join(OUT_ROOT, `audit-${PHASE}.json`);
const PIN = "123456";

const AUTHENTICATED_ROUTES = [
  "/es/dashboard",
  "/es/beneficiaries",
  "/es/my-beneficiary-relationships",
  "/es/digital-assets",
  "/es/billing",
  "/es/billing/plans",
  "/es/settings",
  "/es/settings/preferences",
  "/es/settings/security",
  "/es/wizard",
];

const PUBLIC_ROUTES = ["/es/auth/login", "/es/auth/register", "/es/auth/forgot-password"];

const SCREENSHOT_ROUTES = [
  "/es/dashboard",
  "/es/beneficiaries",
  "/es/my-beneficiary-relationships",
];

test.describe.configure({ mode: "serial" });

test("contrast audit capture", async ({ page, user }) => {
  test.skip(
    !process.env.CONTRAST_AUDIT_PHASE,
    "Set CONTRAST_AUDIT_PHASE=before|after to run the one-off contrast capture",
  );
  test.setTimeout(420_000);
  await fs.mkdir(OUT_DIR, { recursive: true });

  const report: {
    phase: string;
    createdAt: string;
    axeViolations: unknown[];
    pixelSamples: unknown[];
    screenshots: string[];
  } = {
    phase: PHASE,
    createdAt: new Date().toISOString(),
    axeViolations: [],
    pixelSamples: [],
    screenshots: [],
  };

  await loginViaUi(page, user, "en");
  await createPinFromSecurityPage(page, PIN);
  const verifyPin = await page.request.post("/api/security/verify-pin", {
    headers: { "x-real-ip": `203.0.113.${100 + Math.floor(Math.random() * 100)}` },
    data: { pin: PIN },
  });
  if (!verifyPin.ok()) {
    // Retry once — rate-limit / cold secret can flake on first verify.
    const retry = await page.request.post("/api/security/verify-pin", {
      headers: { "x-real-ip": `203.0.113.${100 + Math.floor(Math.random() * 100)}` },
      data: { pin: PIN },
    });
    expect(retry.status(), await retry.text()).toBe(200);
  }

  for (const theme of ["light", "dark"] as const) {
    await setTheme(page, theme);

    for (const route of SCREENSHOT_ROUTES) {
      await page.goto(route, { waitUntil: "networkidle" });
      await setTheme(page, theme);
      await page.waitForTimeout(400);
      const pretty = `${route.split("/").pop()}-es-${theme}.png`;
      const file = path.join(OUT_DIR, pretty);
      await page.screenshot({ path: file, fullPage: true });
      report.screenshots.push(file);

      for (const [kind, sel] of [
        ["title", "main h1.page-title, main h2.page-title, main h1, main h2"],
        ["subtitle", "main .page-subtitle, main h1 + p, main h2 + p"],
      ] as const) {
        try {
          const sample = await sampleContrast(page, sel);
          if (sample) {
            report.pixelSamples.push({ route, theme, locale: "es", kind, ...sample });
          }
        } catch (error) {
          report.pixelSamples.push({ route, theme, locale: "es", kind, error: String(error), pass: false });
        }
      }

      if (route.includes("my-beneficiary-relationships")) {
        try {
          const infoTitle = await sampleContrast(page, "main .info-panel p.font-medium, main [data-slot='card'] p.text-sm.font-medium");
          const infoDesc = await sampleContrast(page, "main .info-panel .info-panel-desc, main .info-panel p.text-sm");
          if (infoTitle) report.pixelSamples.push({ route, theme, locale: "es", kind: "info-title", ...infoTitle });
          if (infoDesc) report.pixelSamples.push({ route, theme, locale: "es", kind: "info-desc", ...infoDesc });
        } catch (error) {
          report.pixelSamples.push({ route, theme, locale: "es", kind: "info-panel", error: String(error), pass: false });
        }
      }

      if (route.endsWith("/beneficiaries")) {
        try {
          const target = await sampleContrast(page, "main button.rounded-full.bg-primary, main button.bg-primary");
          if (target) report.pixelSamples.push({ route, theme, locale: "es", kind: "add-beneficiary-btn", ...target });
        } catch (error) {
          report.pixelSamples.push({ route, theme, locale: "es", kind: "add-beneficiary-btn", error: String(error), pass: false });
        }
      }
    }

    for (const route of [...AUTHENTICATED_ROUTES, ...PUBLIC_ROUTES]) {
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await setTheme(page, theme);
      await page.waitForTimeout(350);
      try {
        const results = await new AxeBuilder({ page }).withTags(["wcag2aa"]).analyze();
        const nodes = (results.violations || [])
          .filter((v) => v.id === "color-contrast")
          .flatMap((v) =>
            (v.nodes || []).map((n) => ({
              route,
              theme,
              locale: "es",
              rule: v.id,
              selector: (n.target || []).join(" "),
              html: (n.html || "").slice(0, 220),
              failureSummary: n.failureSummary,
              data: n.any?.[0]?.data || null,
            })),
          );
        report.axeViolations.push(...nodes);
      } catch (error) {
        report.axeViolations.push({ route, theme, locale: "es", error: String(error) });
      }
    }
  }

  await page.goto("/en/dashboard", { waitUntil: "networkidle" });
  await setTheme(page, "light");
  const enTitle = await sampleContrast(page, "main h1.page-title, main h2.page-title, main h1, main h2");
  if (enTitle) {
    report.pixelSamples.push({ route: "/en/dashboard", theme: "light", locale: "en", kind: "title", ...enTitle });
  }

  await fs.writeFile(REPORT_PATH, JSON.stringify(report, null, 2));

  const pixelFails = (report.pixelSamples as Array<{ pass?: boolean }>).filter((s) => s.pass === false);
  console.log(
    JSON.stringify({
      phase: PHASE,
      screenshots: report.screenshots.length,
      pixelFails: pixelFails.length,
      axeContrastNodes: report.axeViolations.length,
      report: REPORT_PATH,
    }),
  );
});
