/**
 * Permanent expanded contrast coverage (KAN-146).
 * Runs in the normal suite (no CONTRAST_AUDIT_PHASE gate).
 * Target: < 8 minutes — lean matrix vs the one-off full audit.
 *
 * Scope (not exhaustive): authenticated routes in en+es × light+dark desktop,
 * one mobile combo (en/light), key overlays, public routes, payment returns,
 * verify-beneficiary states, real Sonner toasts, and login focus rings.
 * For the full locale×theme×viewport matrix use CONTRAST_AUDIT_PHASE=after
 * on e2e/contrast-full-audit.spec.ts.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures/test";
import { createPinFromSecurityPage, loginViaUi, openProfileMenu } from "./fixtures/ui";
import {
  FOCUS_SELECTORS,
  VIEWPORTS,
  assertPageTitleLayout,
  auditAllVisibleText,
  auditFocusRings,
  sampleContrast,
  setTheme,
  waitForVisualReady,
} from "./lib/contrast";

const PIN = "123456";

const AUTH_ROUTES = [
  "dashboard",
  "beneficiaries",
  "my-beneficiary-relationships",
  "digital-assets",
  "billing",
  "billing/plans",
  "settings",
  "settings/preferences",
  "settings/security",
  "wizard",
] as const;

const PUBLIC_ROUTES = [
  "auth/login",
  "auth/register",
  "auth/forgot-password",
  "auth/reset-password",
  "auth",
] as const;

async function stripNonToastOverlays(page: import("@playwright/test").Page) {
  await page
    .evaluate(() => {
      document
        .querySelectorAll(
          "nextjs-portal, [data-next-badge], [data-nextjs-toast], #__next-build-watcher, [data-nextjs-dialog-overlay]",
        )
        .forEach((el) => el.remove());
      window.getSelection?.()?.removeAllRanges?.();
      (document.activeElement as HTMLElement | null)?.blur?.();
    })
    .catch(() => undefined);
}

async function prepareForContrast(page: import("@playwright/test").Page) {
  await page
    .evaluate(() => {
      // Dismiss via Sonner API — do not remove toast DOM (breaks React Toaster).
      (window as unknown as { __iableeToast?: { dismiss?: () => void } }).__iableeToast?.dismiss?.();
      document
        .querySelectorAll(
          "nextjs-portal, [data-next-badge], [data-nextjs-toast], #__next-build-watcher, [data-nextjs-dialog-overlay]",
        )
        .forEach((el) => el.remove());
      window.getSelection?.()?.removeAllRanges?.();
      (document.activeElement as HTMLElement | null)?.blur?.();
    })
    .catch(() => undefined);
}

async function expectAxeContrast(
  page: import("@playwright/test").Page,
  label: string,
  options?: { keepToasts?: boolean },
) {
  if (options?.keepToasts) {
    await stripNonToastOverlays(page);
  } else {
    await prepareForContrast(page);
  }
  // Settle finite enter animations (cap wait — auth hero uses infinite animate-pulse).
  await page.evaluate(async () => {
    const anims = (document.getAnimations?.() ?? []).filter((a) => {
      const iters = a.effect?.getTiming?.().iterations;
      return iters !== Infinity;
    });
    await Promise.race([
      Promise.all(anims.map((a) => a.finished.catch(() => undefined))),
      new Promise<void>((r) => setTimeout(r, 700)),
    ]);
  });
  const freeze = await page.addStyleTag({
    content: `
      html body, html body *, html body *::before, html body *::after {
        transition: none !important;
      }
      html body .animate-fade-in-up,
      html body .animate-fade-in {
        animation: none !important;
        opacity: 1 !important;
      }
    `,
  });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
  try {
    const results = await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze();
    const violations = results.violations.filter((v) => v.id === "color-contrast");
    expect(
      violations,
      `axe color-contrast failed on ${label}: ${JSON.stringify(
        violations.map((v) => ({
          nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })),
        })),
      )}`,
    ).toEqual([]);
  } finally {
    await freeze.evaluate((el) => {
      if (el.parentNode) el.parentNode.removeChild(el);
    }).catch(() => undefined);
  }
}

async function expectFullTextPass(page: import("@playwright/test").Page, label: string) {
  await prepareForContrast(page);
  const samples = await auditAllVisibleText(page);
  const fails = samples.filter((s) => !s.pass && !s.info);
  expect(
    fails,
    `pixel-fulltext failures on ${label}: ${JSON.stringify(
      fails.slice(0, 12).map((f) => ({
        text: f.text,
        ratio: f.ratio,
        required: f.required,
        fg: f.fg,
        bg: f.bg,
      })),
    )}`,
  ).toEqual([]);
}

test.use({ video: "off", trace: "off" });

test.describe("10 contrast full WCAG AA", () => {
  test.describe.configure({ mode: "serial" });

  test("authenticated routes + key overlays (en+es, light+dark, desktop + one mobile)", async ({
    page,
    user,
  }) => {
    test.setTimeout(420_000);
    page.setDefaultTimeout(15_000);
    page.setDefaultNavigationTimeout(30_000);

    await loginViaUi(page, user, "en");
    await createPinFromSecurityPage(page, PIN);
    const verifyPin = await page.request.post("/api/security/verify-pin", {
      headers: { "x-real-ip": `203.0.113.${170 + Math.floor(Math.random() * 60)}` },
      data: { pin: PIN },
    });
    expect(verifyPin.status()).toBe(200);

    // Seed one asset + beneficiary for populated views
    const typesRes = await page.request.get("/api/asset-types");
    expect(typesRes.ok()).toBeTruthy();
    const types = (await typesRes.json()) as Array<{ key: string }>;
    const assetName = `C10 Asset ${Date.now()}`;
    const benName = `C10 Ben ${Date.now()}`;
    expect(
      (
        await page.request.post("/api/assets", {
          data: { asset_type: types[0]?.key ?? "document", asset_name: assetName },
        })
      ).status(),
    ).toBe(201);
    expect(
      (await page.request.post("/api/beneficiaries", { data: { full_name: benName } })).status(),
    ).toBe(201);

    const combos: Array<{
      locale: "en" | "es";
      theme: "light" | "dark";
      viewport: "desktop" | "mobile";
    }> = [
      { locale: "en", theme: "light", viewport: "desktop" },
      { locale: "en", theme: "dark", viewport: "desktop" },
      { locale: "es", theme: "light", viewport: "desktop" },
      { locale: "es", theme: "dark", viewport: "desktop" },
      // One mobile route pass (en/light); mobile overlays cover both themes below.
      { locale: "en", theme: "light", viewport: "mobile" },
    ];

    async function auditKeyOverlays(
      locale: "en" | "es",
      theme: "light" | "dark",
      viewport: "desktop" | "mobile",
    ) {
      const tag = `${locale} ${theme} ${viewport}`;
      await page.setViewportSize(VIEWPORTS[viewport]);
      await setTheme(page, theme);

      // Add asset dialog
      await page.goto(`/${locale}/digital-assets`, { waitUntil: "domcontentloaded" });
      await setTheme(page, theme);
      await waitForVisualReady(page);
      const add = page.getByRole("button", {
        name: /add new asset|add asset|agregar.*activo|añadir.*activo/i,
      }).first();
      await expect(add).toBeVisible({ timeout: 10_000 });
      await add.click();
      await page.waitForTimeout(300);
      await expect(page.getByRole("dialog").first()).toBeVisible({ timeout: 5_000 });
      await expectAxeContrast(page, `add-asset ${tag}`);
      await expectFullTextPass(page, `add-asset ${tag}`);
      await page.keyboard.press("Escape");

      // Add beneficiary dialog
      await page.goto(`/${locale}/beneficiaries`, { waitUntil: "domcontentloaded" });
      await setTheme(page, theme);
      await waitForVisualReady(page);
      const addBen = page.getByRole("button", {
        name: /add beneficiary|agregar beneficiario|añadir beneficiario/i,
      }).first();
      await expect(addBen).toBeVisible({ timeout: 10_000 });
      await addBen.click();
      await page.waitForTimeout(300);
      await expect(page.getByRole("dialog").first()).toBeVisible({ timeout: 5_000 });
      await expectAxeContrast(page, `add-ben ${tag}`);
      await expectFullTextPass(page, `add-ben ${tag}`);
      await page.keyboard.press("Escape");

      // Delete confirm (beneficiary)
      const benHeading = page.locator("h3").filter({ hasText: benName }).first();
      await expect(benHeading).toBeVisible({ timeout: 10_000 });
      const benCard = page.locator("div").filter({ has: benHeading }).first();
      await benCard.hover().catch(() => undefined);
      const delBen = page.locator('button[title="Delete"], button[title="Eliminar"]').first();
      await expect(delBen).toBeVisible({ timeout: 5_000 });
      await delBen.click();
      await page.waitForTimeout(200);
      await expect(page.getByRole("dialog").first()).toBeVisible({ timeout: 5_000 });
      await expectAxeContrast(page, `delete-confirm ${tag}`);
      await expectFullTextPass(page, `delete-confirm ${tag}`);
      await page.keyboard.press("Escape");

      // PIN change dialog
      await page.goto(`/${locale}/settings/security`, { waitUntil: "domcontentloaded" });
      await setTheme(page, theme);
      await waitForVisualReady(page);
      const changePin = page.getByRole("button", { name: /change security pin|cambiar.*pin/i }).first();
      await expect(changePin).toBeVisible({ timeout: 10_000 });
      await changePin.click();
      await page.waitForTimeout(250);
      await expect(page.locator('input[inputmode="numeric"]').first()).toBeVisible({ timeout: 5_000 });
      await expectAxeContrast(page, `pin-dialog ${tag}`);
      await expectFullTextPass(page, `pin-dialog ${tag}`);
      await page.keyboard.press("Escape");

      if (viewport === "mobile") {
        // Mobile nav drawer
        await page.goto(`/${locale}/dashboard`, { waitUntil: "domcontentloaded" });
        await setTheme(page, theme);
        await waitForVisualReady(page);
        const menuBtn = page.getByRole("button", { name: /open menu/i });
        await expect(menuBtn).toBeVisible({ timeout: 5_000 });
        await menuBtn.click();
        const drawer = page.locator(".fixed.inset-0.z-50.flex.md\\:hidden .bg-sidebar").first();
        await expect(drawer).toBeVisible({ timeout: 5_000 });
        await expectAxeContrast(page, `mobile-drawer ${tag}`);
        await expectFullTextPass(page, `mobile-drawer ${tag}`);

        // User menu / language from drawer profile trigger (fail-closed)
        const profileInDrawer = drawer.getByRole("button", {
          name: /profile|perfil|account|cuenta|user|usuario/i,
        }).first();
        await expect(profileInDrawer, `drawer profile trigger ${tag}`).toBeVisible({
          timeout: 5_000,
        });
        await profileInDrawer.click();
        await page.waitForTimeout(200);
        await expect(
          page.getByRole("menu").or(page.locator("[data-radix-dropdown-menu-content]")).first(),
        ).toBeVisible({ timeout: 5_000 });
        await expectAxeContrast(page, `user-menu ${tag}`);
        await page.keyboard.press("Escape");
        await page.keyboard.press("Escape");
      } else {
        await page.goto(`/${locale}/dashboard`, { waitUntil: "domcontentloaded" });
        await setTheme(page, theme);
        await waitForVisualReady(page);
        await openProfileMenu(page);
        await page.waitForTimeout(200);
        await expect(
          page.getByRole("menu").or(page.locator("[data-radix-dropdown-menu-content]")).first(),
        ).toBeVisible({ timeout: 5_000 });
        await expectAxeContrast(page, `user-menu ${tag}`);
        await page.keyboard.press("Escape");
      }

      // Real Sonner toasts at this viewport/theme
      await page.goto(`/${locale}/settings`, { waitUntil: "domcontentloaded" });
      await setTheme(page, theme);
      await waitForVisualReady(page);
      const toastReady = await page.evaluate(() => {
        const t = (window as unknown as { __iableeToast?: { success?: unknown } }).__iableeToast;
        return typeof t?.success === "function";
      });
      expect(toastReady, `__iableeToast must be exposed (${tag})`).toBe(true);
      for (const kind of ["success", "error", "warning"] as const) {
        await page.evaluate(() => {
          (window as unknown as { __iableeToast?: { dismiss?: () => void } }).__iableeToast?.dismiss?.();
        });
        await page.locator("[data-sonner-toast]").first().waitFor({ state: "detached", timeout: 2_000 }).catch(() => undefined);
        await page.evaluate((type) => {
          const t = (window as unknown as { __iableeToast?: Record<string, (m: string) => void> })
            .__iableeToast;
          t?.[type]?.(`C10 ${type} toast`);
        }, kind);
        const toastLoc = page.locator(`[data-sonner-toast][data-type="${kind}"]`).first();
        await expect(toastLoc).toBeVisible({ timeout: 5_000 });
        // Wait out enter animation — axe composites mid-fade opacity as washed ink.
        await expect(toastLoc).toHaveAttribute("data-mounted", "true");
        await expect(toastLoc).toHaveCSS("opacity", "1");
        await page.waitForTimeout(350);
        const titleRgb = await toastLoc.locator("[data-title]").evaluate((el) => {
          const m = getComputedStyle(el).color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
          return m ? [+m[1], +m[2], +m[3]] : null;
        });
        expect(titleRgb, `toast ${kind} ${tag} title color`).toBeTruthy();
        // Near-white ink means enter animation / wrong theme — do not axe yet.
        // Warning dark uses cream (#F3E1C7); only reject washed pure-white mid-frames.
        const nearWhite = titleRgb!.every((c) => c >= 245);
        expect(nearWhite, `toast ${kind} ${tag} ink washed white: ${titleRgb}`).toBe(false);
        await expectAxeContrast(page, `toast-${kind} ${tag}`, { keepToasts: true });
        const toastSample = await sampleContrast(
          page,
          `[data-sonner-toast][data-type="${kind}"] [data-title], [data-sonner-toast][data-type="${kind}"]`,
          { sampleInside: true },
        );
        expect(toastSample, `missing toast ${kind} ${tag}`).toBeTruthy();
        expect(
          toastSample!.pass,
          `toast ${kind} ${tag} ratio=${toastSample!.ratio}`,
        ).toBe(true);
        await page.evaluate(() => {
          (window as unknown as { __iableeToast?: { dismiss?: () => void } }).__iableeToast?.dismiss?.();
        });
        await page
          .locator("[data-sonner-toast]")
          .first()
          .waitFor({ state: "detached", timeout: 3_000 })
          .catch(() => undefined);
      }
    }

    for (const combo of combos) {
      await page.setViewportSize(VIEWPORTS[combo.viewport]);
      await setTheme(page, combo.theme);

      for (const route of AUTH_ROUTES) {
        const path = `/${combo.locale}/${route}`;
        await page.goto(path, { waitUntil: "domcontentloaded" });
        await setTheme(page, combo.theme);
        await waitForVisualReady(page);
        if (
          route === "dashboard" ||
          route === "settings" ||
          route === "beneficiaries" ||
          route === "billing"
        ) {
          await assertPageTitleLayout(page, `${path} ${combo.theme} ${combo.viewport}`);
        }
        await expectAxeContrast(page, `${path} ${combo.theme} ${combo.viewport}`);
        await expectFullTextPass(page, `${path} ${combo.theme} ${combo.viewport}`);
      }
    }

    // Desktop overlays: one locale×theme sample (en/light) — full matrix lives in full audit.
    await auditKeyOverlays("en", "light", "desktop");
    // Mobile overlays: one locale per theme, both themes (en/light + es/dark).
    await auditKeyOverlays("en", "light", "mobile");
    await auditKeyOverlays("es", "dark", "mobile");

    // Focus rings on key forms — desktop + mobile (en/light), scoped selectors.
    await page.context().clearCookies();
    for (const viewport of ["desktop", "mobile"] as const) {
      await page.setViewportSize(VIEWPORTS[viewport]);
      for (const route of ["auth/login", "auth/register", "auth/forgot-password"] as const) {
        await page.goto(`/en/${route}`, { waitUntil: "domcontentloaded" });
        await setTheme(page, "light");
        await waitForVisualReady(page);
        const rings = await auditFocusRings(page, FOCUS_SELECTORS.form);
        const ringFails = rings.filter((r) => !r.pass);
        expect(
          ringFails,
          `focus-ring failures on /en/${route} ${viewport}: ${JSON.stringify(ringFails)}`,
        ).toEqual([]);
      }
    }

    // Re-auth for settings/dialog focus checks
    await loginViaUi(page, user, "en");
    await page.request.post("/api/security/verify-pin", {
      headers: { "x-real-ip": `203.0.113.${150 + Math.floor(Math.random() * 80)}` },
      data: { pin: PIN },
    });
    for (const viewport of ["desktop", "mobile"] as const) {
      await page.setViewportSize(VIEWPORTS[viewport]);
      await page.goto("/en/settings", { waitUntil: "domcontentloaded" });
      await setTheme(page, "light");
      await waitForVisualReady(page);
      const settingsRings = await auditFocusRings(page, FOCUS_SELECTORS.settings);
      expect(
        settingsRings.filter((r) => !r.pass),
        `settings focus-ring failures ${viewport}`,
      ).toEqual([]);

      await page.goto("/en/beneficiaries", { waitUntil: "domcontentloaded" });
      await setTheme(page, "light");
      await waitForVisualReady(page);
      const addBen = page.getByRole("button", {
        name: /add beneficiary|agregar beneficiario|añadir beneficiario/i,
      });
      await expect(addBen, `add beneficiary ${viewport}`).toBeVisible({ timeout: 8_000 });
      await addBen.click();
      await page.waitForTimeout(250);
      await expect(page.getByRole("dialog").first()).toBeVisible({ timeout: 5_000 });
      const dialogRings = await auditFocusRings(page, FOCUS_SELECTORS.dialog);
      expect(
        dialogRings.filter((r) => !r.pass),
        `add-beneficiary dialog focus-ring failures ${viewport}`,
      ).toEqual([]);
      await page.keyboard.press("Escape");

      if (viewport === "desktop") {
        await page.goto("/en/dashboard", { waitUntil: "domcontentloaded" });
        await setTheme(page, "light");
        await waitForVisualReady(page);
        const navRings = await auditFocusRings(page, FOCUS_SELECTORS.nav);
        expect(
          navRings.filter((r) => !r.pass),
          `sidebar nav focus-ring failures ${viewport}`,
        ).toEqual([]);
      } else {
        await page.goto("/en/dashboard", { waitUntil: "domcontentloaded" });
        await setTheme(page, "light");
        await waitForVisualReady(page);
        const menuBtn = page.getByRole("button", { name: /open menu/i });
        await expect(menuBtn, "mobile open menu").toBeVisible({ timeout: 8_000 });
        await menuBtn.click();
        const drawer = page.locator(".fixed.inset-0.z-50.flex.md\\:hidden .bg-sidebar").first();
        await expect(drawer).toBeVisible({ timeout: 5_000 });
        const drawerRings = await auditFocusRings(page, FOCUS_SELECTORS.nav);
        expect(
          drawerRings.filter((r) => !r.pass),
          `mobile drawer focus-ring failures`,
        ).toEqual([]);
        await page.keyboard.press("Escape");
      }
    }
  });

  test("public routes + payment returns + verify-beneficiary (es+en, light+dark)", async ({
    page,
  }) => {
    test.setTimeout(360_000);
    await page.context().clearCookies();

    for (const locale of ["en", "es"] as const) {
      for (const theme of ["light", "dark"] as const) {
        await page.setViewportSize(VIEWPORTS.desktop);
        await setTheme(page, theme);

        await page.goto(`/${locale}`, { waitUntil: "domcontentloaded" });
        await setTheme(page, theme);
        await waitForVisualReady(page);
        await expectAxeContrast(page, `landing ${locale} ${theme}`);
        const premium = await sampleContrast(
          page,
          'main a[href*="auth/register"] button.btn-primary-gradient, main a[href*="auth/register"] button',
          { forcePixel: true, sampleInside: true },
        );
        expect(premium, `missing premium CTA ${locale} ${theme}`).toBeTruthy();
        expect(premium!.pass, `premium CTA ${locale} ${theme} ${premium!.ratio}`).toBe(true);

        for (const route of PUBLIC_ROUTES) {
          await page.goto(`/${locale}/${route}`, { waitUntil: "domcontentloaded" });
          await setTheme(page, theme);
          await waitForVisualReady(page);
          await expectAxeContrast(page, `/${locale}/${route} ${theme}`);
          await expectFullTextPass(page, `/${locale}/${route} ${theme}`);
        }

        await page.route("**/api/payments/wompi/transaction**", async (route) => {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ status: "APPROVED", reference: "e2e-c10" }),
          });
        });
        await page.goto(`/${locale}/payments/wompi/return?id=e2e-c10`, {
          waitUntil: "domcontentloaded",
        });
        await setTheme(page, theme);
        await page.waitForTimeout(300);
        await expectAxeContrast(page, `wompi ${locale} ${theme}`);
        await page.unroute("**/api/payments/wompi/transaction**");

        await page.goto(`/${locale}/payments/payu/return?state=APPROVED&referenceCode=e2e`, {
          waitUntil: "domcontentloaded",
        });
        await setTheme(page, theme);
        await expectAxeContrast(page, `payu ${locale} ${theme}`);

        for (const status of ["success", "invalid", "expired"] as const) {
          await page.goto(`/${locale}/verify-beneficiary-email?status=${status}`, {
            waitUntil: "domcontentloaded",
          });
          await setTheme(page, theme);
          await expectAxeContrast(page, `verify-${status} ${locale} ${theme}`);
        }
      }
    }
  });
});
