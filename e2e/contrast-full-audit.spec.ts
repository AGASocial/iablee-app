/**
 * Exhaustive WCAG AA contrast audit (KAN-146).
 *
 * CONTRAST_AUDIT_PHASE=before|after PLAYWRIGHT_E2E_REAL_SUPABASE=1 \
 * PLAYWRIGHT_TEST_BASE_URL=http://localhost:3007 \
 * npx playwright test e2e/contrast-full-audit.spec.ts
 *
 * Optional filters:
 *   CONTRAST_AUDIT_LOCALES=es
 *   CONTRAST_AUDIT_THEMES=light,dark
 *   CONTRAST_AUDIT_VIEWPORTS=desktop,mobile
 *   CONTRAST_AUDIT_APPEND=1          (append to existing ndjson; keep screenshots)
 *   CONTRAST_AUDIT_SKIP_PUBLIC=1     (authenticated matrix only)
 *   CONTRAST_AUDIT_AUTH_ONLY=1       (alias of SKIP_PUBLIC)
 *
 * Writes:
 *   /tmp/iablee-contrast3-shots/<phase>/*.png
 *   /tmp/iablee-contrast3-shots/audit-<phase>.json (summary)
 *   /tmp/iablee-contrast3-shots/audit-<phase>.ndjson (every check, streamed)
 *   /tmp/iablee-contrast3-shots/FINDINGS-<phase>.md
 */
import fs from "node:fs/promises";
import path from "node:path";
import { expect, test } from "./fixtures/test";
import { createPinFromSecurityPage, loginViaUi } from "./fixtures/ui";
import { setTheme } from "./lib/contrast";
import {
  FOCUS_SELECTORS,
  OUT_ROOT,
  PIN,
  applyViewport,
  auditAuthValidation,
  auditInteractiveAuthenticated,
  auditPaymentReturns,
  auditVerifyBeneficiary,
  auditWizardSteps,
  captureState,
  buildExpectedAuditStates,
  createChecksSink,
  gotoThemed,
  installAuditGuards,
  loadChecksFromNdjson,
  parseAuditFilters,
  reconcileExpectedStates,
  seedPopulatedData,
  seedSinkCountsFromNdjson,
  writeFindingsMarkdown,
  type AuditContext,
} from "./lib/contrast-audit-runner";

function focusOptsForAuthRoute(route: string): {
  focus: boolean;
  focusSelector?: string;
  borders?: boolean;
} {
  if (
    route === "auth/login" ||
    route === "auth/register" ||
    route === "auth/forgot-password" ||
    route === "auth/reset-password"
  ) {
    return { focus: true, focusSelector: FOCUS_SELECTORS.form, borders: true };
  }
  return { focus: false, borders: false };
}

function focusOptsForAppRoute(route: string): {
  focus: boolean;
  focusSelector?: string;
  borders?: boolean;
} {
  if (route.includes("settings") || route === "billing") {
    return { focus: true, focusSelector: FOCUS_SELECTORS.settings, borders: true };
  }
  if (route === "dashboard") {
    return { focus: true, focusSelector: FOCUS_SELECTORS.nav, borders: false };
  }
  return { focus: true, focusSelector: FOCUS_SELECTORS.primary, borders: false };
}

const PHASE = process.env.CONTRAST_AUDIT_PHASE || "";
const PHASE_DIR = path.join(OUT_ROOT, PHASE || "unset");
const REPORT_PATH = path.join(OUT_ROOT, `audit-${PHASE || "unset"}.json`);
const NDJSON_PATH = path.join(OUT_ROOT, `audit-${PHASE || "unset"}.ndjson`);

const AUTHENTICATED_ROUTES = [
  "dashboard",
  "beneficiaries",
  "my-beneficiary-relationships",
  "digital-assets",
  "billing",
  "billing/plans",
  "settings",
  "settings/preferences",
  "settings/security",
] as const;

const PUBLIC_ROUTES = [
  "auth/login",
  "auth/register",
  "auth/forgot-password",
  "auth/reset-password",
  "auth",
] as const;

test.describe.configure({ mode: "serial" });

// Audit runs are long; video/trace retention after assertion failures can hang fixture teardown.
test.use({ video: "off", trace: "off", screenshot: "off" });

test("KAN-146 full contrast audit", async ({ page, user }) => {
  test.skip(
    PHASE !== "before" && PHASE !== "after",
    "Set CONTRAST_AUDIT_PHASE=before|after to run the exhaustive contrast audit",
  );
  test.setTimeout(7_200_000);
  // Fail-closed timeouts so a stuck click/navigation cannot hang for 25+ minutes
  page.setDefaultTimeout(15_000);
  page.setDefaultNavigationTimeout(30_000);

  const filters = parseAuditFilters();
  await fs.mkdir(PHASE_DIR, { recursive: true });
  await fs.mkdir(OUT_ROOT, { recursive: true });

  if (!filters.append) {
    await fs.writeFile(NDJSON_PATH, "");
  } else {
    // Ensure file exists; do not wipe existing before data
    try {
      await fs.access(NDJSON_PATH);
    } catch {
      await fs.writeFile(NDJSON_PATH, "");
    }
  }

  const sink = createChecksSink(NDJSON_PATH);
  if (filters.append) {
    await seedSinkCountsFromNdjson(sink, NDJSON_PATH);
  }
  const screenshots: string[] = [];
  // Preserve existing screenshot inventory in append mode
  if (filters.append) {
    try {
      const existing = await fs.readdir(PHASE_DIR);
      for (const f of existing) {
        if (f.endsWith(".png")) screenshots.push(path.join(PHASE_DIR, f));
      }
    } catch {
      /* empty */
    }
  }

  await installAuditGuards(page);

  await loginViaUi(page, user, "en");
  await createPinFromSecurityPage(page, PIN);
  const verifyPin = await page.request.post("/api/security/verify-pin", {
    headers: { "x-real-ip": `203.0.113.${160 + Math.floor(Math.random() * 70)}` },
    data: { pin: PIN },
  });
  if (!verifyPin.ok()) {
    const retry = await page.request.post("/api/security/verify-pin", {
      headers: { "x-real-ip": `203.0.113.${160 + Math.floor(Math.random() * 70)}` },
      data: { pin: PIN },
    });
    expect(retry.status(), await retry.text()).toBe(200);
  }

  const runEmptyStates =
    filters.locales.includes("en") &&
    filters.themes.includes("light") &&
    filters.viewports.includes("desktop") &&
    !filters.append;

  if (runEmptyStates) {
    const ctx: AuditContext = { locale: "en", theme: "light", viewport: "desktop" };
    await applyViewport(page, "desktop");
    await setTheme(page, "light");
    await gotoThemed(page, ctx, "/en/digital-assets");
    await captureState(
      page,
      sink,
      screenshots,
      PHASE_DIR,
      ctx,
      "/en/digital-assets",
      "digital-assets-empty",
    );
    await gotoThemed(page, ctx, "/en/beneficiaries");
    await captureState(
      page,
      sink,
      screenshots,
      PHASE_DIR,
      ctx,
      "/en/beneficiaries",
      "beneficiaries-empty",
    );
  }

  const seeded = await seedPopulatedData(page);

  const { locales, themes, viewports } = filters;

  if (!filters.skipPublic) {
    const publicCtx = await page.context().browser()!.newContext({
      baseURL: process.env.PLAYWRIGHT_TEST_BASE_URL || "http://localhost:3007",
    });
    const publicPage = await publicCtx.newPage();
    publicPage.setDefaultTimeout(15_000);
    publicPage.setDefaultNavigationTimeout(30_000);
    await installAuditGuards(publicPage);
    try {
      for (const locale of locales) {
        for (const theme of themes) {
          for (const viewport of viewports) {
            const ctx: AuditContext = { locale, theme, viewport };
            await applyViewport(publicPage, viewport);
            await publicPage.addInitScript((t) => {
              try {
                localStorage.setItem("iablee-theme", t);
              } catch {
                /* ignore */
              }
            }, theme);

            await gotoThemed(publicPage, ctx, `/${locale}`);
            await captureState(
              publicPage,
              sink,
              screenshots,
              PHASE_DIR,
              ctx,
              `/${locale}`,
              "landing",
            );
            if (locale === "en") {
              await gotoThemed(publicPage, ctx, "/");
              await captureState(
                publicPage,
                sink,
                screenshots,
                PHASE_DIR,
                ctx,
                "/",
                "root-landing",
              );
            }

            for (const route of PUBLIC_ROUTES) {
              await gotoThemed(publicPage, ctx, `/${locale}/${route}`);
              await captureState(
                publicPage,
                sink,
                screenshots,
                PHASE_DIR,
                ctx,
                `/${locale}/${route}`,
                `route-${route.replace(/\//g, "-")}`,
                focusOptsForAuthRoute(route),
              );
            }
            await auditAuthValidation(publicPage, sink, screenshots, PHASE_DIR, ctx);
            await auditPaymentReturns(publicPage, sink, screenshots, PHASE_DIR, ctx);
            await auditVerifyBeneficiary(publicPage, sink, screenshots, PHASE_DIR, ctx);
          }
        }
      }
    } finally {
      await publicCtx.close().catch(() => undefined);
    }
  }

  // Re-verify PIN after public matrix (session still on main page)
  await page.request.post("/api/security/verify-pin", {
    headers: { "x-real-ip": `203.0.113.${160 + Math.floor(Math.random() * 70)}` },
    data: { pin: PIN },
  });

  for (const locale of locales) {
    for (const theme of themes) {
      for (const viewport of viewports) {
        const ctx: AuditContext = { locale, theme, viewport };
        await applyViewport(page, viewport);
        await setTheme(page, theme);

        const authRoutes =
          filters.routes.length > 0
            ? AUTHENTICATED_ROUTES.filter((r) =>
                filters.routes.includes(r.toLowerCase()),
              )
            : AUTHENTICATED_ROUTES;
        for (const route of authRoutes) {
          await gotoThemed(page, ctx, `/${locale}/${route}`);
          await captureState(
            page,
            sink,
            screenshots,
            PHASE_DIR,
            ctx,
            `/${locale}/${route}`,
            `route-${route.replace(/\//g, "-")}`,
            focusOptsForAppRoute(route),
          );
        }

        if (filters.includeWizard) {
          await auditWizardSteps(page, sink, screenshots, PHASE_DIR, ctx);
        }
        if (filters.includeInteractive) {
          await auditInteractiveAuthenticated(
            page,
            sink,
            screenshots,
            PHASE_DIR,
            ctx,
            seeded.assetTypes,
            seeded.assetName,
            seeded.beneficiaryName,
          );
        }
      }
    }
  }

  const failuresOnly = sink.memory.filter(
    (c) => !c.pass && !c.info && c.method !== "skipped",
  );
  const report = {
    phase: PHASE,
    createdAt: new Date().toISOString(),
    filters,
    ndjson: NDJSON_PATH,
    screenshots: screenshots.length,
    summary: sink.counts,
    failures: failuresOnly.slice(0, 500),
  };
  await fs.writeFile(REPORT_PATH, JSON.stringify(report, null, 2));
  let timestampedNdjson: string | null = null;
  if (PHASE === "after") {
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    timestampedNdjson = path.join(OUT_ROOT, `audit-after-${ts}.ndjson`);
    await fs.copyFile(NDJSON_PATH, timestampedNdjson);
  }
  const findingsPath = await writeFindingsMarkdown(
    PHASE,
    failuresOnly,
    screenshots,
    sink.counts,
  );

  console.log(
    JSON.stringify({
      phase: PHASE,
      filters,
      ...sink.counts,
      screenshots: screenshots.length,
      report: REPORT_PATH,
      ndjson: NDJSON_PATH,
      timestampedNdjson,
      findings: findingsPath,
    }),
  );

  if (PHASE === "after") {
    const allChecks = await loadChecksFromNdjson(NDJSON_PATH);
    const expected = buildExpectedAuditStates({
      filters,
      assetKeys: seeded.assetTypes.map((t) => t.key),
    });
    const coverage = reconcileExpectedStates(allChecks, expected);
    // Close page before asserting so fixture teardown cannot hang on video/trace.
    await page.context().close().catch(() => undefined);
    expect(
      sink.counts.fail,
      `After-audit still has ${sink.counts.fail} contrast failures. See ${findingsPath}`,
    ).toBe(0);
    expect(
      sink.counts.skipped,
      `After-audit still has ${sink.counts.skipped} skipped/timeout states. See ${findingsPath}`,
    ).toBe(0);
    expect(
      coverage.missing,
      `After-audit missing ${coverage.missing.length} expected states (present ${coverage.present}/${expected.length}): ${JSON.stringify(coverage.missing.slice(0, 20))}`,
    ).toEqual([]);
    expect(
      coverage.thin,
      `After-audit thin captures (≪ sibling / below floor): ${JSON.stringify(coverage.thin.slice(0, 20))}`,
    ).toEqual([]);
  }
});
