import fs from "node:fs/promises";
import path from "node:path";
import { expect, type Page } from "@playwright/test";
import {
  FOCUS_SELECTORS,
  VIEWPORTS,
  type AuditCheck,
  type ViewportName,
  auditPageState,
  guessSourceFile,
  setTheme,
  waitForVisualReady,
} from "./contrast";
import { openProfileMenu } from "../fixtures/ui";

export { FOCUS_SELECTORS };
export const PIN = "123456";
export const OUT_ROOT = "/tmp/iablee-contrast3-shots";

/** Per-state wall clock — audit + screenshot must finish or SKIPPED. */
export const STATE_CAPTURE_TIMEOUT_MS = Number(
  process.env.CONTRAST_AUDIT_STATE_TIMEOUT_MS || 90_000,
);

const PAYMENT_HOST_RE =
  /(?:^|\.)((?:checkout\.)?wompi\.(?:co|com)|(?:secure\.)?payu(?:latam)?\.(?:com|co)|(?:checkout|js|api)\.stripe\.com|stripe\.com|pay\.google\.com)/i;

export type AuditContext = {
  locale: "en" | "es";
  theme: "light" | "dark";
  viewport: ViewportName;
};

export type AuditFilters = {
  locales: Array<"en" | "es">;
  themes: Array<"light" | "dark">;
  viewports: ViewportName[];
  append: boolean;
  skipPublic: boolean;
  authOnly: boolean;
  /** When set, only these authenticated route slugs + matching interactive states. */
  routes: string[];
  includeWizard: boolean;
  includeInteractive: boolean;
};

export function parseAuditFilters(): AuditFilters {
  const locales = (process.env.CONTRAST_AUDIT_LOCALES || "en,es")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is "en" | "es" => s === "en" || s === "es");
  const themes = (process.env.CONTRAST_AUDIT_THEMES || "light,dark")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is "light" | "dark" => s === "light" || s === "dark");
  const viewports = (process.env.CONTRAST_AUDIT_VIEWPORTS || "desktop,mobile")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is ViewportName => s === "desktop" || s === "mobile");
  const append =
    process.env.CONTRAST_AUDIT_APPEND === "1" ||
    process.env.CONTRAST_AUDIT_APPEND === "true";
  const skipPublic =
    process.env.CONTRAST_AUDIT_SKIP_PUBLIC === "1" ||
    process.env.CONTRAST_AUDIT_AUTH_ONLY === "1";
  const authOnly = process.env.CONTRAST_AUDIT_AUTH_ONLY === "1";
  const routes = (process.env.CONTRAST_AUDIT_ROUTES || "")
    .split(",")
    .map((s) => s.trim().replace(/^\/+/, "").toLowerCase())
    .filter(Boolean);
  const includeWizard =
    routes.length === 0 ||
    routes.includes("wizard") ||
    process.env.CONTRAST_AUDIT_WIZARD === "1";
  const includeInteractive =
    routes.length === 0 ||
    process.env.CONTRAST_AUDIT_INTERACTIVE !== "0";
  return {
    locales: locales.length ? locales : ["en", "es"],
    themes: themes.length ? themes : ["light", "dark"],
    viewports: viewports.length ? viewports : ["desktop", "mobile"],
    append,
    skipPublic: skipPublic || authOnly,
    authOnly,
    routes,
    includeWizard,
    includeInteractive,
  };
}

export function shotName(ctx: AuditContext, state: string): string {
  const safe = state.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120);
  return `${ctx.locale}-${ctx.theme}-${ctx.viewport}-${safe}.png`;
}

export async function applyViewport(page: Page, viewport: ViewportName) {
  await page.setViewportSize(VIEWPORTS[viewport]);
}

export type ChecksSink = {
  /** All checks streamed to disk; in-memory array holds failures (+ capped info). */
  memory: AuditCheck[];
  ndjsonPath?: string;
  counts: { total: number; pass: number; fail: number; info: number; skipped: number };
};

export function createChecksSink(ndjsonPath?: string): ChecksSink {
  return {
    memory: [],
    ndjsonPath,
    counts: { total: 0, pass: 0, fail: 0, info: 0, skipped: 0 },
  };
}

export async function seedSinkCountsFromNdjson(
  sink: ChecksSink,
  ndjsonPath: string,
): Promise<void> {
  try {
    const raw = await fs.readFile(ndjsonPath, "utf-8");
    for (const line of raw.split("\n")) {
      if (!line) continue;
      const c = JSON.parse(line) as AuditCheck;
      sink.counts.total += 1;
      if (c.method === "skipped" || c.state?.startsWith("SKIPPED:")) {
        sink.counts.skipped += 1;
        if (!c.pass && !c.info) sink.memory.push(c);
      } else if (c.info) {
        sink.counts.info += 1;
      } else if (!c.pass) {
        sink.counts.fail += 1;
        sink.memory.push(c);
      } else {
        sink.counts.pass += 1;
      }
    }
  } catch {
    /* no prior file */
  }
}

export async function appendChecks(sink: ChecksSink, found: AuditCheck[]): Promise<void> {
  const lines: string[] = [];
  for (const c of found) {
    const slim: AuditCheck = {
      ...c,
      text: (c.text || "").slice(0, 120),
      failureSummary: c.failureSummary ? c.failureSummary.slice(0, 200) : undefined,
      selector: (c.selector || "").slice(0, 200),
    };
    lines.push(JSON.stringify(slim));
    sink.counts.total += 1;
    if (slim.method === "skipped") {
      sink.counts.skipped += 1;
      sink.memory.push(slim);
    } else if (slim.info) {
      sink.counts.info += 1;
      if (sink.memory.filter((x) => x.info).length < 150) sink.memory.push(slim);
    } else if (!slim.pass) {
      sink.counts.fail += 1;
      sink.memory.push(slim);
    } else {
      sink.counts.pass += 1;
    }
  }
  if (sink.ndjsonPath && lines.length) {
    await fs.appendFile(sink.ndjsonPath, `${lines.join("\n")}\n`);
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout ${ms}ms: ${label}`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}

const guardedPages = new WeakSet<Page>();

/** Auto-dismiss JS dialogs; abort navigations/requests to hosted payment gateways. */
export async function installAuditGuards(page: Page): Promise<void> {
  if (guardedPages.has(page)) {
    // Routes may have been cleared; re-assert payment abort.
    await page.route(PAYMENT_HOST_RE, async (route) => {
      await route.abort("blockedbyclient");
    });
    return;
  }
  guardedPages.add(page);

  page.on("dialog", async (dialog) => {
    try {
      await dialog.dismiss();
    } catch {
      try {
        await dialog.accept();
      } catch {
        /* ignore */
      }
    }
  });

  await page.route(PAYMENT_HOST_RE, async (route) => {
    await route.abort("blockedbyclient");
  });

  // Hide Next.js dev issue/error toasts (MISSING_MESSAGE etc.) — they paint red under UI.
  await page.addStyleTag({
    content: `
      nextjs-portal, [data-next-badge], [data-nextjs-toast],
      #__next-build-watcher, [data-nextjs-dialog-overlay] {
        display: none !important;
        visibility: hidden !important;
        pointer-events: none !important;
      }
    `,
  }).catch(() => undefined);

  page.on("framenavigated", (frame) => {
    if (frame !== page.mainFrame()) return;
    const url = frame.url();
    if (/^https?:/i.test(url) && !/localhost|127\.0\.0\.1/.test(url)) {
      if (PAYMENT_HOST_RE.test(url)) {
        void page
          .goto("about:blank", { waitUntil: "domcontentloaded", timeout: 5_000 })
          .catch(() => undefined);
      }
    }
  });
}

export async function ensureOnLocalhost(page: Page): Promise<boolean> {
  const url = page.url();
  if (/localhost|127\.0\.0\.1|about:blank/.test(url)) return true;
  try {
    await page.goto("about:blank", { waitUntil: "domcontentloaded", timeout: 5_000 });
  } catch {
    /* ignore */
  }
  return false;
}

export async function resetToLocalRoute(
  page: Page,
  ctx: AuditContext,
  url: string,
): Promise<void> {
  await ensureOnLocalhost(page);
  await gotoThemed(page, ctx, url);
}

export async function captureState(
  page: Page,
  checks: AuditCheck[] | ChecksSink,
  screenshots: string[],
  phaseDir: string,
  ctx: AuditContext,
  route: string,
  state: string,
  options?: {
    focus?: boolean;
    focusSelector?: string;
    borders?: boolean;
    screenshot?: boolean;
    /** Keep Sonner toasts visible (blocked-checkout / toast-* states). */
    preserveToasts?: boolean;
    /** Actual URL after an interactive action (recorded on each check row). */
    finalUrl?: string;
  },
): Promise<void> {
  const ctxFull = {
    route,
    state,
    locale: ctx.locale,
    theme: ctx.theme,
    viewport: ctx.viewport,
  };
  const finalUrl = options?.finalUrl;

  const recordSkipped = async (reason: string) => {
    // Skips are failures for after-phase integrity (timeouts must not greenwash).
    const skipped: AuditCheck = {
      ...ctxFull,
      selector: "",
      text: `SKIPPED: ${reason}`.slice(0, 120),
      fg: null,
      bg: null,
      ratio: null,
      required: 0,
      pass: false,
      method: "skipped",
      info: false,
      failureSummary: reason.slice(0, 200),
      finalUrl,
    };
    if (Array.isArray(checks)) {
      checks.push(skipped);
    } else {
      await appendChecks(checks, [skipped]);
    }
  };

  const keepToasts =
    options?.preserveToasts === true ||
    /toast/i.test(state) ||
    state === "plans-checkout-attempt-blocked";

  try {
    await withTimeout(
      (async () => {
        await ensureOnLocalhost(page);
        // Strip Next.js overlays. Dismiss Sonner via API (never remove toast DOM —
        // that breaks React's Toaster insertBefore). Keep toasts for toast-* /
        // blocked-checkout states.
        await page
          .evaluate((preserveToasts) => {
            if (!preserveToasts) {
              const t = (window as unknown as { __iableeToast?: { dismiss?: () => void } })
                .__iableeToast;
              t?.dismiss?.();
            }
            document
              .querySelectorAll(
                "nextjs-portal, [data-next-badge], [data-nextjs-toast], #__next-build-watcher, [data-nextjs-dialog-overlay]",
              )
              .forEach((el) => el.remove());
            const selection = window.getSelection?.();
            if (selection && selection.removeAllRanges) selection.removeAllRanges();
            const active = document.activeElement as HTMLElement | null;
            if (active && typeof active.blur === "function") active.blur();
          }, keepToasts)
          .catch(() => undefined);
        const found = await auditPageState(page, ctxFull, options);
        const withUrl = finalUrl
          ? found.map((c) => ({ ...c, finalUrl }))
          : found;
        if (Array.isArray(checks)) {
          checks.push(...withUrl);
        } else {
          await appendChecks(checks, withUrl);
        }

        if (options?.screenshot !== false) {
          const file = path.join(phaseDir, shotName(ctx, state));
          await page
            .screenshot({ path: file, fullPage: true, timeout: 15_000 })
            .catch(async () => {
              await page.screenshot({ path: file, fullPage: false, timeout: 8_000 });
            });
          screenshots.push(file);
        }
      })(),
      STATE_CAPTURE_TIMEOUT_MS,
      `captureState ${ctx.locale}-${ctx.theme}-${ctx.viewport}-${state}`,
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await recordSkipped(reason);
    await dismissOverlays(page);
    await ensureOnLocalhost(page);
  }
}

export async function gotoThemed(
  page: Page,
  ctx: AuditContext,
  url: string,
  wait: "domcontentloaded" | "networkidle" = "domcontentloaded",
) {
  await ensureOnLocalhost(page);
  try {
    await page.goto(url, { waitUntil: wait, timeout: 30_000 });
  } catch (err) {
    await ensureOnLocalhost(page);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {
      throw err;
    });
  }
  await setTheme(page, ctx.theme);
  await waitForVisualReady(page);
}

export async function dismissOverlays(page: Page) {
  await page.keyboard.press("Escape").catch(() => undefined);
  await page.keyboard.press("Escape").catch(() => undefined);
  await page.waitForTimeout(100);
}

export async function seedPopulatedData(page: Page): Promise<{
  assetName: string;
  beneficiaryName: string;
  assetTypes: Array<{ key: string; label?: string }>;
}> {
  const assetTypesResponse = await page.request.get("/api/asset-types");
  if (!assetTypesResponse.ok()) {
    throw new Error(`asset-types ${assetTypesResponse.status()}`);
  }
  const assetTypes = (await assetTypesResponse.json()) as Array<{ key: string; label?: string }>;
  const assetName = `Contrast Asset ${Date.now()}`;
  const beneficiaryName = `Contrast Beneficiary ${Date.now()}`;

  const createAsset = await page.request.post("/api/assets", {
    data: {
      asset_type: assetTypes[0]?.key ?? "document",
      asset_name: assetName,
      description: "Contrast audit seeded asset",
    },
  });
  if (createAsset.status() !== 201) {
    throw new Error(`create asset ${createAsset.status()} ${await createAsset.text()}`);
  }

  const relationships = await page.request.get("/api/relationships");
  const relBody = relationships.ok()
    ? ((await relationships.json()) as Array<{ id: number }>)
    : [];
  const createBen = await page.request.post("/api/beneficiaries", {
    data: {
      full_name: beneficiaryName,
      email: `e2e-ben-${Date.now()}@iablee.test`,
      relationship_id: relBody[0]?.id,
    },
  });
  // Some envs may require different payload — tolerate 201/200
  if (createBen.status() !== 201 && createBen.status() !== 200) {
    // Fallback minimal payload
    const retry = await page.request.post("/api/beneficiaries", {
      data: { full_name: beneficiaryName },
    });
    if (retry.status() !== 201 && retry.status() !== 200) {
      throw new Error(`create beneficiary ${retry.status()} ${await retry.text()}`);
    }
  }

  return { assetName, beneficiaryName, assetTypes };
}

export async function mockWompiTransaction(page: Page, status: string) {
  await page.route("**/api/payments/wompi/transaction**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status,
        reference: `e2e-ref-${status.toLowerCase()}`,
      }),
    });
  });
}

export async function blockHostedCheckout(page: Page) {
  await page.route("**/api/billing/subscriptions**", async (route) => {
    if (route.request().method() === "POST" || route.request().method() === "PATCH") {
      // Non-OK so the plans UI stays local and surfaces toast.error (not a fake success → /billing).
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          error: "e2e-blocked-checkout",
          message: "Checkout blocked in contrast audit",
        }),
      });
      return;
    }
    await route.continue();
  });
  // Also block any checkout redirect URLs the API might have returned previously
  await page.route(PAYMENT_HOST_RE, async (route) => {
    await route.abort("blockedbyclient");
  });
}

/** Walk wizard steps (start → type → asset → beneficiary), auditing each. */
export async function auditWizardSteps(
  page: Page,
  checks: AuditCheck[] | ChecksSink,
  screenshots: string[],
  phaseDir: string,
  ctx: AuditContext,
) {
  const locale = ctx.locale;
  await gotoThemed(page, ctx, `/${locale}/wizard`);
  await captureState(page, checks, screenshots, phaseDir, ctx, `/${locale}/wizard`, "wizard-landing");

  const start = page.getByRole("button", { name: /^(start|empezar)$/i });
  await expect(start, "wizard Start CTA").toBeVisible({ timeout: 10_000 });
  await start.click();
  await page.waitForTimeout(300);
  await captureState(page, checks, screenshots, phaseDir, ctx, `/${locale}/wizard`, "wizard-step-type");

  const typeOpt = page.locator('[data-asset-type-option="true"]').first();
  await expect(typeOpt, "wizard asset-type option").toBeVisible({ timeout: 10_000 });
  await typeOpt.click();
  const next = page.getByRole("button", { name: /^(next|siguiente)$/i });
  await expect(next, "wizard Next CTA").toBeVisible({ timeout: 8_000 });
  await next.click();
  await page.waitForTimeout(300);
  await captureState(page, checks, screenshots, phaseDir, ctx, `/${locale}/wizard`, "wizard-step-asset");

  const name = page.locator("#asset-name");
  await expect(name, "wizard asset-name field").toBeVisible({ timeout: 10_000 });
  await name.fill("Contrast Wizard Asset");
  const desc = page.locator("#asset-description");
  if (await desc.isVisible().catch(() => false)) {
    await desc.fill("Wizard contrast description");
  }
  const more = page.getByRole("button", { name: /more options|más opciones/i });
  if (await more.isVisible().catch(() => false)) {
    await more.click();
    const msg = page.getByRole("textbox", { name: /write here|escribe aquí|escribe aqui/i });
    if (await msg.isVisible().catch(() => false)) {
      await msg.fill("Required wizard message for contrast audit");
    }
  }
  await expect(next, "wizard Next after asset").toBeVisible({ timeout: 8_000 });
  await next.click();
  await page.waitForTimeout(300);
  await captureState(
    page,
    checks,
    screenshots,
    phaseDir,
    ctx,
    `/${locale}/wizard`,
    "wizard-step-beneficiary",
  );
  await dismissOverlays(page);
}

export async function auditAuthValidation(
  page: Page,
  checks: AuditCheck[] | ChecksSink,
  screenshots: string[],
  phaseDir: string,
  ctx: AuditContext,
) {
  const locale = ctx.locale;

  await gotoThemed(page, ctx, `/${locale}/auth/login`);
  await page.locator('form button[type="submit"]').click({ timeout: 5_000 });
  await page.waitForTimeout(200);
  await captureState(
    page,
    checks,
    screenshots,
    phaseDir,
    ctx,
    `/${locale}/auth/login`,
    "auth-login-validation",
    { focus: true, focusSelector: FOCUS_SELECTORS.form, borders: true },
  );

  await gotoThemed(page, ctx, `/${locale}/auth/register`);
  await page.locator('form button[type="submit"]').click({ timeout: 5_000 });
  await page.waitForTimeout(200);
  await captureState(
    page,
    checks,
    screenshots,
    phaseDir,
    ctx,
    `/${locale}/auth/register`,
    "auth-register-validation-empty",
    { focus: true, focusSelector: FOCUS_SELECTORS.form, borders: true },
  );

  const email = page.getByLabel(/email/i);
  if (await email.isVisible().catch(() => false)) {
    await email.fill("not-an-email");
  }
  const password = page.locator('input[type="password"]').first();
  if (await password.isVisible().catch(() => false)) {
    await password.fill("weak");
  }
  await page.locator('form button[type="submit"]').click();
  await page.waitForTimeout(250);
  await captureState(
    page,
    checks,
    screenshots,
    phaseDir,
    ctx,
    `/${locale}/auth/register`,
    "auth-register-weak-password",
    { focus: true, focusSelector: FOCUS_SELECTORS.form, borders: true },
  );

  await gotoThemed(page, ctx, `/${locale}/auth/forgot-password`);
  await page.waitForTimeout(200);
  await captureState(
    page,
    checks,
    screenshots,
    phaseDir,
    ctx,
    `/${locale}/auth/forgot-password`,
    "auth-forgot-password",
    { focus: true, focusSelector: FOCUS_SELECTORS.form, borders: true },
  );

  await gotoThemed(page, ctx, `/${locale}/auth/reset-password`);
  await page.waitForTimeout(200);
  await captureState(
    page,
    checks,
    screenshots,
    phaseDir,
    ctx,
    `/${locale}/auth/reset-password`,
    "auth-reset-password",
    { focus: true, focusSelector: FOCUS_SELECTORS.form, borders: true },
  );
  const resetPw = page.locator('input[type="password"]').first();
  if (await resetPw.isVisible().catch(() => false)) {
    await resetPw.fill("weak");
    await page.waitForTimeout(200);
    await captureState(
      page,
      checks,
      screenshots,
      phaseDir,
      ctx,
      `/${locale}/auth/reset-password`,
      "auth-reset-weak-password",
      { focus: true, focusSelector: FOCUS_SELECTORS.form, borders: true },
    );
  }
}

export async function auditInteractiveAuthenticated(
  page: Page,
  checks: AuditCheck[] | ChecksSink,
  screenshots: string[],
  phaseDir: string,
  ctx: AuditContext,
  assetTypes: Array<{ key: string; label?: string }>,
  assetName: string,
  beneficiaryName: string,
) {
  const locale = ctx.locale;
  const isMobile = ctx.viewport === "mobile";

  // Empty → already seeded; capture populated digital-assets + beneficiaries
  await gotoThemed(page, ctx, `/${locale}/digital-assets`);
  await captureState(
    page,
    checks,
    screenshots,
    phaseDir,
    ctx,
    `/${locale}/digital-assets`,
    "digital-assets-populated",
  );

  // Add asset dialog for every type (fail-closed — seeded user always has Add)
  {
    await gotoThemed(page, ctx, `/${locale}/digital-assets`);
    const addBtn = page.getByRole("button", {
      name: /add new asset|agregar.*activo|añadir.*activo/i,
    });
    await expect(addBtn, `add-asset button required (${locale}/${ctx.theme}/${ctx.viewport})`).toBeVisible({
      timeout: 8_000,
    });
    await addBtn.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog, "add-asset picker dialog").toBeVisible({ timeout: 8_000 });
    const typeCards = dialog.locator(
      "button[data-asset-type], button[data-asset-type-option], button.group, button.rounded-2xl",
    );
    await expect(typeCards.first(), "asset type cards in picker").toBeVisible({ timeout: 8_000 });
    await captureState(
      page,
      checks,
      screenshots,
      phaseDir,
      ctx,
      `/${locale}/digital-assets`,
      "add-asset-picker",
    );
    const keys =
      assetTypes.length > 0
        ? assetTypes.map((t) => t.key)
        : ["letter", "audio", "photo", "video", "document"];
    await dismissOverlays(page);

    for (const key of keys) {
      await gotoThemed(page, ctx, `/${locale}/digital-assets`);
      await expect(addBtn).toBeVisible({ timeout: 8_000 });
      await addBtn.click();
      await expect(page.getByRole("dialog")).toBeVisible({ timeout: 8_000 });
      const card = page
        .getByRole("dialog")
        .locator(`button[data-asset-type="${key}"]`)
        .or(
          page
            .getByRole("dialog")
            .locator("button[data-asset-type-option], button.group, button.rounded-2xl")
            .nth(keys.indexOf(key)),
        );
      await expect(card.first(), `asset type card ${key}`).toBeVisible({ timeout: 8_000 });
      await card.first().click();
      await page.waitForTimeout(300);
      await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5_000 });
      await captureState(
        page,
        checks,
        screenshots,
        phaseDir,
        ctx,
        `/${locale}/digital-assets`,
        `add-asset-${key}`,
        { focus: true, focusSelector: FOCUS_SELECTORS.dialog },
      );
      await dismissOverlays(page);
    }
  }

  // Edit asset dialog (fail-closed — seedPopulatedData created assetName)
  await gotoThemed(page, ctx, `/${locale}/digital-assets`);
  const assetRow = page.getByText(assetName).first();
  await expect(assetRow, `seeded asset ${assetName}`).toBeVisible({ timeout: 8_000 });
  await assetRow.click();
  await page.waitForTimeout(200);
  const edit = page.locator('button[title="Edit"], button[title="Editar"]').first();
  await expect(edit, "edit asset control").toBeVisible({ timeout: 5_000 });
  await edit.click();
  await page.waitForTimeout(250);
  await expect(page.getByRole("dialog").first()).toBeVisible({ timeout: 5_000 });
  await captureState(
    page,
    checks,
    screenshots,
    phaseDir,
    ctx,
    `/${locale}/digital-assets`,
    "edit-asset-dialog",
    { focus: true, focusSelector: FOCUS_SELECTORS.dialog },
  );
  await dismissOverlays(page);

  // Delete confirmation
  await gotoThemed(page, ctx, `/${locale}/digital-assets`);
  await expect(assetRow).toBeVisible({ timeout: 8_000 });
  await assetRow.click();
  await page.waitForTimeout(200);
  const del = page.getByRole("button", { name: /^delete$|^eliminar$/i }).first();
  await expect(del, "delete asset control").toBeVisible({ timeout: 5_000 });
  await del.click();
  await page.waitForTimeout(200);
  await captureState(
    page,
    checks,
    screenshots,
    phaseDir,
    ctx,
    `/${locale}/digital-assets`,
    "delete-asset-confirm",
  );
  await dismissOverlays(page);

  // Beneficiaries add/edit/delete (fail-closed)
  await gotoThemed(page, ctx, `/${locale}/beneficiaries`);
  await captureState(
    page,
    checks,
    screenshots,
    phaseDir,
    ctx,
    `/${locale}/beneficiaries`,
    "beneficiaries-populated",
  );
  const addBen = page.getByRole("button", {
    name: /add beneficiary|agregar beneficiario|añadir beneficiario/i,
  });
  await expect(addBen, "add beneficiary button").toBeVisible({ timeout: 8_000 });
  await addBen.click();
  await page.waitForTimeout(250);
  await expect(page.getByRole("dialog").first()).toBeVisible({ timeout: 5_000 });
  await captureState(
    page,
    checks,
    screenshots,
    phaseDir,
    ctx,
    `/${locale}/beneficiaries`,
    "add-beneficiary-dialog",
    { focus: true, focusSelector: FOCUS_SELECTORS.dialog },
  );
  await dismissOverlays(page);

  const benCard = page.locator(`div:has(h3:has-text("${beneficiaryName}"))`).first();
  await expect(benCard, `seeded beneficiary ${beneficiaryName}`).toBeVisible({ timeout: 8_000 });
  await benCard.hover();
  const editBen = benCard.locator('button[title="Edit"], button[title="Editar"]');
  await expect(editBen, "edit beneficiary").toBeVisible({ timeout: 5_000 });
  await editBen.click();
  await page.waitForTimeout(250);
  await expect(page.getByRole("dialog").first()).toBeVisible({ timeout: 5_000 });
  await captureState(
    page,
    checks,
    screenshots,
    phaseDir,
    ctx,
    `/${locale}/beneficiaries`,
    "edit-beneficiary-dialog",
    { focus: true, focusSelector: FOCUS_SELECTORS.dialog },
  );
  await dismissOverlays(page);

  await gotoThemed(page, ctx, `/${locale}/beneficiaries`);
  await expect(benCard).toBeVisible({ timeout: 8_000 });
  await benCard.hover();
  const delBen = benCard.locator('button[title="Delete"], button[title="Eliminar"]');
  await expect(delBen, "delete beneficiary").toBeVisible({ timeout: 5_000 });
  await delBen.click();
  await page.waitForTimeout(200);
  await captureState(
    page,
    checks,
    screenshots,
    phaseDir,
    ctx,
    `/${locale}/beneficiaries`,
    "delete-beneficiary-confirm",
  );
  await dismissOverlays(page);

  // PIN change form + mismatch error (inline card — not a dialog)
  await gotoThemed(page, ctx, `/${locale}/settings/security`);
  const changePin = page.getByRole("button", { name: /change security pin|cambiar.*pin/i }).first();
  await expect(changePin, "change security PIN button").toBeVisible({ timeout: 8_000 });
  await changePin.click({ timeout: 5_000 });
  await page.waitForTimeout(250);
  await captureState(
    page,
    checks,
    screenshots,
    phaseDir,
    ctx,
    `/${locale}/settings/security`,
    "pin-change-dialog",
    { focus: true, focusSelector: FOCUS_SELECTORS.settings, borders: false },
  );
  // Error: fill new + confirm with mismatch so pinsDoNotMatch text appears
  const pinBoxes = page.locator('input[inputmode="numeric"]');
  await expect(pinBoxes.first(), "PIN inputs on change form").toBeVisible({ timeout: 5_000 });
  const boxCount = await pinBoxes.count();
  // Expect 3 groups × 6 = 18 when hasPin, else 2 × 6 = 12
  expect(boxCount, `expected PIN digit boxes, got ${boxCount}`).toBeGreaterThanOrEqual(12);
  const fillGroup = async (start: number, digits: string) => {
    for (let i = 0; i < 6; i += 1) {
      await pinBoxes.nth(start + i).fill(digits[i]!);
    }
  };
  if (boxCount >= 18) {
    await fillGroup(0, "123456"); // current
    await fillGroup(6, "654321"); // new
    await fillGroup(12, "111111"); // confirm mismatch
  } else {
    await fillGroup(0, "654321");
    await fillGroup(6, "111111");
  }
  await expect(
    page.getByText(/do not match|no coinciden|no coinciden los pin|pins?.*match/i).first(),
  ).toBeVisible({ timeout: 5_000 });
  await captureState(
    page,
    checks,
    screenshots,
    phaseDir,
    ctx,
    `/${locale}/settings/security`,
    "pin-change-error",
    { focus: true, focusSelector: FOCUS_SELECTORS.settings, borders: false },
  );
  await dismissOverlays(page);
  // Cancel / leave change form
  const cancelPin = page.getByRole("button", { name: /cancel|cancelar/i }).first();
  if (await cancelPin.isVisible().catch(() => false)) {
    await cancelPin.click().catch(() => undefined);
  }

  // Plan selection (block checkout) — never leave localhost
  await blockHostedCheckout(page);
  await gotoThemed(page, ctx, `/${locale}/billing/plans`);
  await captureState(
    page,
    checks,
    screenshots,
    phaseDir,
    ctx,
    `/${locale}/billing/plans`,
    "plans-selection",
  );
  const subscribe = page.getByRole("button", { name: /subscribe|suscribir/i }).first();
  await expect(subscribe, "subscribe / checkout CTA").toBeVisible({ timeout: 8_000 });
  // Payment hosts already aborted via installAuditGuards + blockHostedCheckout.
  // Capture the page the user actually lands on after Subscribe — never remount
  // /billing/plans under this label (that invents a resting state and wipes toasts).
  await subscribe.click({ timeout: 10_000 });
  await page.waitForTimeout(800);
  // If a blocked external navigation somehow completed, abort should have kept
  // us local; do NOT resetToLocalRoute(/billing/plans).
  const stillLocal = /localhost|127\.0\.0\.1/.test(page.url());
  if (!stillLocal) {
    // Fail-closed: leave non-local URL recorded; ensureOnLocalhost in capture
    // will blank only if needed — prefer staying put when already aborted.
    await page.goBack({ waitUntil: "domcontentloaded", timeout: 5_000 }).catch(() => undefined);
  }
  const finalUrl = page.url();
  let captureRoute = `/${locale}/billing/plans`;
  try {
    if (/localhost|127\.0\.0\.1/.test(finalUrl)) {
      captureRoute = new URL(finalUrl).pathname || captureRoute;
    }
  } catch {
    /* keep plans path */
  }
  // Wait for toast and/or main chrome on the actual destination (plans or /billing).
  await page
    .locator('[data-sonner-toast], main h1, main .page-title')
    .first()
    .waitFor({ state: "visible", timeout: 12_000 })
    .catch(() => undefined);
  await page
    .getByText(/loading subscription|cargando suscripci|loading plans|cargando planes/i)
    .first()
    .waitFor({ state: "hidden", timeout: 10_000 })
    .catch(() => undefined);
  await expect(
    page.locator("main .page-title, main h1, [data-sonner-toast]").first(),
    "plans-checkout-attempt-blocked must show local main or toast chrome",
  ).toBeVisible({ timeout: 12_000 });
  await waitForVisualReady(page);
  await captureState(
    page,
    checks,
    screenshots,
    phaseDir,
    ctx,
    captureRoute,
    "plans-checkout-attempt-blocked",
    { preserveToasts: true, finalUrl },
  );
  await page.unroute("**/api/billing/subscriptions**").catch(() => undefined);
  // Fresh goto after checkout attempt so a stuck navigation cannot poison later states
  await resetToLocalRoute(page, ctx, `/${locale}/dashboard`);

  // User menu + language submenu (fail closed — expected on desktop)
  if (!isMobile) {
    await openProfileMenu(page);
    await page.waitForTimeout(200);
    await expect(
      page.getByRole("menu").or(page.locator("[data-radix-dropdown-menu-content]")).first(),
    ).toBeVisible({ timeout: 5_000 });
    await captureState(
      page,
      checks,
      screenshots,
      phaseDir,
      ctx,
      `/${locale}/dashboard`,
      "user-menu-dropdown",
    );
    const lang = page
      .getByRole("menuitem", { name: /language|idioma/i })
      .or(page.getByText(/language|idioma/i));
    await expect(lang.first()).toBeVisible({ timeout: 5_000 });
    await lang.first().hover({ timeout: 3_000 });
    await lang.first().click({ timeout: 3_000 });
    await page.waitForTimeout(200);
    await captureState(
      page,
      checks,
      screenshots,
      phaseDir,
      ctx,
      `/${locale}/dashboard`,
      "language-switcher",
    );
    await dismissOverlays(page);
    // Language click may navigate to the other locale — restore ctx locale before sidebar
    await resetToLocalRoute(page, ctx, `/${locale}/dashboard`);

    const collapseBtn = page.getByRole("button", { name: /toggle sidebar/i });
    await expect(collapseBtn, "desktop sidebar toggle").toBeVisible({ timeout: 8_000 });
    await collapseBtn.click();
    await page.waitForTimeout(250);
    await captureState(
      page,
      checks,
      screenshots,
      phaseDir,
      ctx,
      `/${locale}/dashboard`,
      "sidebar-collapsed",
    );
    await collapseBtn.click();
    await page.waitForTimeout(200);
    await captureState(
      page,
      checks,
      screenshots,
      phaseDir,
      ctx,
      `/${locale}/dashboard`,
      "sidebar-expanded",
      { focus: true, focusSelector: FOCUS_SELECTORS.nav },
    );
  } else {
    // Mobile nav drawer
    const menuBtn = page
      .getByRole("button", { name: /menu|open|abrir|navegación|navigation/i })
      .or(page.locator("header button").first());
    await expect(menuBtn.first()).toBeVisible({ timeout: 8_000 });
    await menuBtn.first().click({ timeout: 8_000 });
    await page.waitForTimeout(300);
    const drawer = page.locator(".fixed.inset-0.z-50.flex.md\\:hidden .bg-sidebar").first();
    await expect(drawer).toBeVisible({ timeout: 5_000 });
    // Assert drawer surface is opaque (production uses solid --sidebar).
    const drawerAlpha = await drawer.evaluate((el) => {
      const parseA = (color: string): number => {
        if (!color || color === "transparent") return 0;
        const comma = color.match(/rgba?\([^)]+,\s*([\d.]+)\s*\)/);
        if (comma) return +comma[1];
        const modern = color.match(/\/\s*([\d.]+%?)\s*\)/);
        if (modern) {
          return modern[1].endsWith("%") ? parseFloat(modern[1]) / 100 : +modern[1];
        }
        return 1;
      };
      return parseA(getComputedStyle(el).backgroundColor);
    });
    expect(
      drawerAlpha,
      `mobile drawer surface must be opaque (α=${drawerAlpha}); composite if translucent`,
    ).toBeGreaterThanOrEqual(1);
    // Measurement hygiene only: inert main so pixel sampling does not read
    // dashboard cards through the open drawer. Production drawer is unchanged.
    await page
      .evaluate(() => {
        document.querySelector("main")?.setAttribute("inert", "");
        document.querySelector("main")?.setAttribute("aria-hidden", "true");
      })
      .catch(() => undefined);
    await captureState(
      page,
      checks,
      screenshots,
      phaseDir,
      ctx,
      `/${locale}/dashboard`,
      "mobile-nav-drawer",
      { focus: true, focusSelector: FOCUS_SELECTORS.nav },
    );
    await page
      .evaluate(() => {
        document.querySelector("main")?.removeAttribute("inert");
        document.querySelector("main")?.removeAttribute("aria-hidden");
      })
      .catch(() => undefined);
    await dismissOverlays(page);
  }

  // Fresh reset before toasts
  await resetToLocalRoute(page, ctx, `/${locale}/settings`);

  // Toasts — real Sonner via window.__iableeToast (success / error / warning)
  {
    const toastReady = await page.evaluate(() => {
      const t = (window as unknown as { __iableeToast?: { success?: unknown } }).__iableeToast;
      return typeof t?.success === "function";
    });
    expect(toastReady, "Sonner toast helper (__iableeToast) must be exposed for contrast audits").toBe(
      true,
    );

    for (const kind of ["success", "error", "warning"] as const) {
      await page.evaluate((type) => {
        const t = (
          window as unknown as {
            __iableeToast?: {
              success: (m: string) => void;
              error: (m: string) => void;
              warning: (m: string) => void;
              dismiss: () => void;
            };
          }
        ).__iableeToast;
        if (!t?.[type]) throw new Error(`__iableeToast.${type} missing`);
        t.dismiss?.();
        t[type](`Contrast ${type} toast`);
      }, kind);
      const toastLoc = page.locator(`[data-sonner-toast][data-type="${kind}"]`).first();
      await expect(toastLoc).toBeVisible({ timeout: 10_000 });
      // Wait for enter animation / opacity to settle so axe sees token colours.
      await expect(toastLoc).toHaveAttribute("data-mounted", "true");
      await expect(toastLoc).toHaveCSS("opacity", "1");
      await page.waitForTimeout(350);
      await captureState(
        page,
        checks,
        screenshots,
        phaseDir,
        ctx,
        `/${locale}/settings`,
        `toast-${kind}`,
      );
      await page.evaluate(() => {
        const t = (window as unknown as { __iableeToast?: { dismiss: () => void } }).__iableeToast;
        t?.dismiss?.();
      });
      await page
        .locator("[data-sonner-toast]")
        .first()
        .waitFor({ state: "detached", timeout: 3_000 })
        .catch(() => undefined);
      await page.waitForTimeout(150);
    }
  }

  // Preferences language switcher (fail-closed)
  await resetToLocalRoute(page, ctx, `/${locale}/settings/preferences`);
  const langTrigger = page
    .locator('[role="combobox"], button')
    .filter({ hasText: /english|español|spanish|idioma|language/i })
    .first();
  await expect(langTrigger, "preferences language switcher").toBeVisible({ timeout: 8_000 });
  await langTrigger.click({ timeout: 8_000 });
  await page.waitForTimeout(200);
  await captureState(
    page,
    checks,
    screenshots,
    phaseDir,
    ctx,
    `/${locale}/settings/preferences`,
    "preferences-language-switcher",
  );
  await dismissOverlays(page);

  // Theme: no UI theme switcher in app (next-themes storage only); setTheme applied.
  await resetToLocalRoute(page, ctx, `/${locale}/dashboard`);
}

export async function auditPaymentReturns(
  page: Page,
  checks: AuditCheck[] | ChecksSink,
  screenshots: string[],
  phaseDir: string,
  ctx: AuditContext,
) {
  const locale = ctx.locale;
  for (const status of ["APPROVED", "PENDING", "ERROR"] as const) {
    await mockWompiTransaction(page, status === "ERROR" ? "ERROR" : status);
    await gotoThemed(
      page,
      ctx,
      `/${locale}/payments/wompi/return?id=e2e-tx-${status.toLowerCase()}`,
    );
    await page.waitForTimeout(400);
    await captureState(
      page,
      checks,
      screenshots,
      phaseDir,
      ctx,
      `/${locale}/payments/wompi/return`,
      `wompi-${status.toLowerCase()}`,
    );
    await page.unroute("**/api/payments/wompi/transaction**").catch(() => undefined);
  }
  // missing id
  await gotoThemed(page, ctx, `/${locale}/payments/wompi/return`);
  await captureState(
    page,
    checks,
    screenshots,
    phaseDir,
    ctx,
    `/${locale}/payments/wompi/return`,
    "wompi-missing-id",
  );

  for (const [state, q] of [
    ["approved", "state=APPROVED&referenceCode=e2e-payu-ok"],
    ["pending", "state=PENDING&referenceCode=e2e-payu-pending"],
    ["declined", "state=DECLINED&referenceCode=e2e-payu-declined"],
  ] as const) {
    await gotoThemed(page, ctx, `/${locale}/payments/payu/return?${q}`);
    await captureState(
      page,
      checks,
      screenshots,
      phaseDir,
      ctx,
      `/${locale}/payments/payu/return`,
      `payu-${state}`,
    );
  }
  await gotoThemed(page, ctx, `/${locale}/payments/payu/return`);
  await captureState(
    page,
    checks,
    screenshots,
    phaseDir,
    ctx,
    `/${locale}/payments/payu/return`,
    "payu-missing-params",
  );
}

export async function auditVerifyBeneficiary(
  page: Page,
  checks: AuditCheck[] | ChecksSink,
  screenshots: string[],
  phaseDir: string,
  ctx: AuditContext,
) {
  const locale = ctx.locale;
  for (const status of ["success", "expired", "invalid", "used"] as const) {
    await gotoThemed(page, ctx, `/${locale}/verify-beneficiary-email?status=${status}`);
    await captureState(
      page,
      checks,
      screenshots,
      phaseDir,
      ctx,
      `/${locale}/verify-beneficiary-email`,
      `verify-${status}`,
    );
  }
  // missing token / missing status → invalid
  await gotoThemed(page, ctx, `/${locale}/verify-beneficiary-email`);
  await captureState(
    page,
    checks,
    screenshots,
    phaseDir,
    ctx,
    `/${locale}/verify-beneficiary-email`,
    "verify-missing-token",
  );
}

export async function loadChecksFromNdjson(ndjsonPath: string): Promise<AuditCheck[]> {
  try {
    const raw = await fs.readFile(ndjsonPath, "utf-8");
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as AuditCheck);
  } catch {
    return [];
  }
}

/** Absolute floor for check counts — thin captures (blank/redirect) fail after-phase. */
export const THIN_CAPTURE_MIN_CHECKS: Record<string, number> = {
  "plans-checkout-attempt-blocked": 25,
  "pin-change-error": 12,
  "pin-change-dialog": 12,
  "add-asset-picker": 8,
  "sidebar-collapsed": 5,
  "sidebar-expanded": 5,
  "mobile-nav-drawer": 8,
  "toast-success": 3,
  "toast-error": 3,
  "toast-warning": 3,
};

export type ExpectedStateKey = {
  locale: "en" | "es";
  theme: "light" | "dark";
  viewport: ViewportName;
  state: string;
};

/**
 * Inventory of states the full AFTER audit must contain for the active filters.
 * Missing keys or thin check counts fail the after-phase (fail-closed coverage).
 */
export function buildExpectedAuditStates(opts: {
  filters: AuditFilters;
  assetKeys: string[];
}): ExpectedStateKey[] {
  const { filters, assetKeys } = opts;
  const keys = assetKeys.length
    ? assetKeys
    : ["letter", "audio", "photo", "video", "document"];
  const out: ExpectedStateKey[] = [];
  const push = (
    locale: "en" | "es",
    theme: "light" | "dark",
    viewport: ViewportName,
    state: string,
  ) => {
    out.push({ locale, theme, viewport, state });
  };

  for (const locale of filters.locales) {
    for (const theme of filters.themes) {
      for (const viewport of filters.viewports) {
        if (!filters.skipPublic) {
          for (const s of [
            "landing",
            "route-auth",
            "route-auth-login",
            "route-auth-register",
            "route-auth-forgot-password",
            "route-auth-reset-password",
            "auth-login-validation",
            "auth-register-validation-empty",
            "auth-register-weak-password",
            "auth-forgot-password",
            "auth-reset-password",
            "wompi-approved",
            "wompi-pending",
            "wompi-error",
            "wompi-missing-id",
            "payu-approved",
            "payu-pending",
            "payu-declined",
            "payu-missing-params",
            "verify-missing-token",
            "verify-invalid",
            "verify-expired",
            "verify-used",
            "verify-success",
          ]) {
            push(locale, theme, viewport, s);
          }
          // Root landing `/` is English-only in the audit matrix
          if (locale === "en") push(locale, theme, viewport, "root-landing");
        }

        if (filters.routes.length === 0) {
          for (const s of [
            "route-dashboard",
            "route-beneficiaries",
            "route-my-beneficiary-relationships",
            "route-digital-assets",
            "route-billing",
            "route-billing-plans",
            "route-settings",
            "route-settings-preferences",
            "route-settings-security",
          ]) {
            push(locale, theme, viewport, s);
          }
        } else {
          for (const r of filters.routes) {
            // Wizard is covered by wizard-landing / wizard-step-* (not route-wizard).
            if (r === "wizard" || r.startsWith("wizard/")) continue;
            push(locale, theme, viewport, `route-${r.replace(/\//g, "-")}`);
          }
        }

        if (filters.includeWizard) {
          for (const s of [
            "wizard-landing",
            "wizard-step-type",
            "wizard-step-asset",
            "wizard-step-beneficiary",
          ]) {
            push(locale, theme, viewport, s);
          }
        }

        if (filters.includeInteractive) {
          push(locale, theme, viewport, "digital-assets-populated");
          push(locale, theme, viewport, "add-asset-picker");
          for (const k of keys) push(locale, theme, viewport, `add-asset-${k}`);
          push(locale, theme, viewport, "edit-asset-dialog");
          push(locale, theme, viewport, "delete-asset-confirm");
          push(locale, theme, viewport, "beneficiaries-populated");
          push(locale, theme, viewport, "add-beneficiary-dialog");
          push(locale, theme, viewport, "edit-beneficiary-dialog");
          push(locale, theme, viewport, "delete-beneficiary-confirm");
          push(locale, theme, viewport, "pin-change-dialog");
          push(locale, theme, viewport, "pin-change-error");
          push(locale, theme, viewport, "plans-selection");
          push(locale, theme, viewport, "plans-checkout-attempt-blocked");
          push(locale, theme, viewport, "toast-success");
          push(locale, theme, viewport, "toast-error");
          push(locale, theme, viewport, "toast-warning");
          push(locale, theme, viewport, "preferences-language-switcher");
          if (viewport === "desktop") {
            push(locale, theme, viewport, "user-menu-dropdown");
            push(locale, theme, viewport, "language-switcher");
            push(locale, theme, viewport, "sidebar-collapsed");
            push(locale, theme, viewport, "sidebar-expanded");
          } else {
            push(locale, theme, viewport, "mobile-nav-drawer");
          }
        }
      }
    }
  }
  return out;
}

export function reconcileExpectedStates(
  checks: AuditCheck[],
  expected: ExpectedStateKey[],
): {
  present: number;
  missing: ExpectedStateKey[];
  thin: Array<ExpectedStateKey & { count: number; min: number }>;
} {
  const counts = new Map<string, number>();
  for (const c of checks) {
    const k = `${c.locale}|${c.theme}|${c.viewport}|${c.state}`;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const missing: ExpectedStateKey[] = [];
  const thin: Array<ExpectedStateKey & { count: number; min: number }> = [];
  for (const e of expected) {
    const k = `${e.locale}|${e.theme}|${e.viewport}|${e.state}`;
    const count = counts.get(k) || 0;
    if (count === 0) {
      missing.push(e);
      continue;
    }
    const min = THIN_CAPTURE_MIN_CHECKS[e.state] ?? 3;
    if (count < min) thin.push({ ...e, count, min });
  }
  return { present: expected.length - missing.length, missing, thin };
}

function failureDedupeKey(c: AuditCheck): string {
  const fg = Array.isArray(c.fg) ? c.fg.join(",") : "";
  const bg = Array.isArray(c.bg) ? c.bg.join(",") : "";
  const text = (c.text || "").slice(0, 80);
  // Group the same visual token across locales/themes/viewports
  return `${c.route}|${c.state.replace(/^(en|es)-/, "")}|${text}|${fg}|${bg}|${c.method}|${c.required}`;
}

export async function writeFindingsMarkdown(
  phase: string,
  checks: AuditCheck[],
  screenshots: string[],
  counts?: {
    total: number;
    pass: number;
    fail: number;
    info: number;
    skipped?: number;
  },
): Promise<string> {
  const ndjsonPath = path.join(OUT_ROOT, `audit-${phase}.ndjson`);
  const allFromDisk: AuditCheck[] = [];
  try {
    const raw = await fs.readFile(ndjsonPath, "utf-8");
    for (const line of raw.split("\n")) {
      if (!line) continue;
      allFromDisk.push(JSON.parse(line) as AuditCheck);
    }
  } catch {
    allFromDisk.push(...checks);
  }

  const failures = allFromDisk.filter((c) => !c.pass && !c.info && c.method !== "skipped");
  const passes = counts?.pass ?? allFromDisk.filter((c) => c.pass && !c.info).length;
  const total = counts?.total ?? allFromDisk.length;
  const failCount = counts?.fail ?? failures.length;
  const infoCount =
    counts?.info ?? allFromDisk.filter((c) => c.info && c.method !== "skipped").length;
  const skippedCount =
    counts?.skipped ?? allFromDisk.filter((c) => c.method === "skipped").length;

  const lines: string[] = [];
  lines.push(`# Contrast FINDINGS — ${phase}`);
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(
    `Checks: ${total} (pass=${passes}, fail=${failCount}, info/exempt=${infoCount}, skipped=${skippedCount})`,
  );
  lines.push(`Screenshots: ${screenshots.length}`);
  lines.push("");

  // Coverage matrix
  const keys = new Map<string, { pass: number; fail: number; total: number }>();
  for (const c of allFromDisk) {
    if (c.info || c.method === "skipped") continue;
    const key = `${c.route} | ${c.state} | ${c.locale} | ${c.theme} | ${c.viewport}`;
    const row = keys.get(key) || { pass: 0, fail: 0, total: 0 };
    row.total += 1;
    if (c.pass) row.pass += 1;
    else row.fail += 1;
    keys.set(key, row);
  }

  lines.push("## Coverage matrix");
  lines.push("");
  lines.push("| Route / state | Locale | Theme | Viewport | Result | Pass/Fail/Total |");
  lines.push("|---|---|---|---|---|---|");
  for (const [key, row] of [...keys.entries()].sort()) {
    const [route, state, locale, theme, viewport] = key.split(" | ");
    const result = row.fail === 0 ? "PASS" : "FAIL";
    lines.push(
      `| ${route} / ${state} | ${locale} | ${theme} | ${viewport} | ${result} | ${row.pass}/${row.fail}/${row.total} |`,
    );
  }
  lines.push("");

  // Deduplicated failures by element/token — aggregate locales/themes/viewports
  type Agg = {
    sample: AuditCheck;
    locales: Set<string>;
    themes: Set<string>;
    viewports: Set<string>;
    states: Set<string>;
    worstRatio: number | null;
  };
  const agg = new Map<string, Agg>();
  for (const f of failures) {
    const k = failureDedupeKey(f);
    const existing = agg.get(k);
    if (!existing) {
      agg.set(k, {
        sample: f,
        locales: new Set([f.locale]),
        themes: new Set([f.theme]),
        viewports: new Set([f.viewport]),
        states: new Set([f.state]),
        worstRatio: f.ratio,
      });
    } else {
      existing.locales.add(f.locale);
      existing.themes.add(f.theme);
      existing.viewports.add(f.viewport);
      existing.states.add(f.state);
      if (
        f.ratio != null &&
        (existing.worstRatio == null || f.ratio < existing.worstRatio)
      ) {
        existing.worstRatio = f.ratio;
        existing.sample = f;
      }
    }
  }

  lines.push("## Failures (deduplicated by element/token)");
  lines.push("");
  if (agg.size === 0) {
    lines.push("_No AA failures (info/exempt only)._");
  } else {
    lines.push(
      "| Route/state | Locales | Themes | Viewports | Element/text | FG | BG | Ratio (worst) | Required | Method | Source |",
    );
    lines.push("|---|---|---|---|---|---|---|---|---|---|---|");
    for (const a of [...agg.values()].sort((x, y) =>
      `${x.sample.route}/${x.sample.state}`.localeCompare(
        `${y.sample.route}/${y.sample.state}`,
      ),
    )) {
      const f = a.sample;
      const stateList = [...a.states].slice(0, 3).join(", ");
      lines.push(
        `| ${f.route} / ${stateList} | ${[...a.locales].sort().join(",")} | ${[...a.themes].sort().join(",")} | ${[...a.viewports].sort().join(",")} | ${JSON.stringify(f.text).slice(0, 80)} | ${f.fg} | ${f.bg} | ${a.worstRatio} | ${f.required} | ${f.method} | ${guessSourceFile(f.route, f.state)} |`,
      );
    }
  }
  lines.push("");
  lines.push(`Deduped failure groups: ${agg.size} (raw fails: ${failures.length})`);
  lines.push("");

  if (phase === "after") {
    lines.push("## Before → after (deduped failure ratios)");
    lines.push("");
    try {
      const beforeRaw = await fs.readFile(path.join(OUT_ROOT, "audit-before.ndjson"), "utf-8");
      const beforeFails: AuditCheck[] = [];
      for (const line of beforeRaw.split("\n")) {
        if (!line) continue;
        const c = JSON.parse(line) as AuditCheck;
        if (!c.pass && !c.info && c.method !== "skipped") beforeFails.push(c);
      }
      const beforeAgg = new Map<string, Agg>();
      for (const f of beforeFails) {
        const k = failureDedupeKey(f);
        const existing = beforeAgg.get(k);
        if (!existing) {
          beforeAgg.set(k, {
            sample: f,
            locales: new Set([f.locale]),
            themes: new Set([f.theme]),
            viewports: new Set([f.viewport]),
            states: new Set([f.state]),
            worstRatio: f.ratio,
          });
        } else if (
          f.ratio != null &&
          (existing.worstRatio == null || f.ratio < existing.worstRatio)
        ) {
          existing.worstRatio = f.ratio;
          existing.sample = f;
        }
      }
      const afterKeys = new Set(agg.keys());
      lines.push("| Element/text | Method | Before ratio | After ratio | Status | Source |");
      lines.push("|---|---|---|---|---|---|");
      for (const [k, b] of [...beforeAgg.entries()].sort()) {
        const a = agg.get(k);
        const afterRatio = a?.worstRatio ?? "PASS";
        const status = afterKeys.has(k) ? "STILL FAIL" : "FIXED";
        lines.push(
          `| ${JSON.stringify(b.sample.text).slice(0, 60)} | ${b.sample.method} | ${b.worstRatio} | ${afterRatio} | ${status} | ${guessSourceFile(b.sample.route, b.sample.state)} |`,
        );
      }
      lines.push("");
      lines.push(
        `Before deduped fails: ${beforeAgg.size}; after deduped fails: ${agg.size}`,
      );
      lines.push("");
    } catch {
      lines.push("_Before ndjson unavailable for comparison._");
      lines.push("");
    }
  }

  const out = path.join(OUT_ROOT, `FINDINGS-${phase}.md`);
  await fs.writeFile(out, lines.join("\n"));
  return out;
}
