import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures/test";
import { createPinFromSecurityPage, loginViaUi } from "./fixtures/ui";
import { assertPageTitleLayout, sampleContrast, setTheme } from "./lib/contrast";

const PIN = "123456";

const ROUTES = [
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
  "/es/auth/login",
  "/es/auth/register",
  "/es/auth/forgot-password",
];

const HEADER_ROUTES = [
  "/es/dashboard",
  "/es/beneficiaries",
  "/es/my-beneficiary-relationships",
];

test.describe("09 contrast WCAG AA", () => {
  test.describe.configure({ mode: "serial" });

  test("axe color-contrast + sampled page headers over background image", async ({
    page,
    user,
  }) => {
    test.setTimeout(360_000);

    await loginViaUi(page, user, "en");
    await createPinFromSecurityPage(page, PIN);
    const verifyPin = await page.request.post("/api/security/verify-pin", {
      headers: { "x-real-ip": `203.0.113.${150 + Math.floor(Math.random() * 80)}` },
      data: { pin: PIN },
    });
    expect(verifyPin.status()).toBe(200);

    for (const theme of ["light", "dark"] as const) {
      await setTheme(page, theme);

      for (const route of ROUTES) {
        await page.goto(route, { waitUntil: "domcontentloaded" });
        await setTheme(page, theme);
        await page.waitForTimeout(400);
        // Drop transient overlays that confuse axe (toasts / nextjs issue badge).
        await page
          .evaluate(() => {
            (window as unknown as { __iableeToast?: { dismiss?: () => void } }).__iableeToast?.dismiss?.();
            document
              .querySelectorAll(
                "nextjs-portal, [data-next-badge], [data-nextjs-toast], #__next-build-watcher",
              )
              .forEach((el) => el.remove());
          })
          .catch(() => undefined);

        // Snap transitions so primary CTA hover mid-frames cannot wash #FFFFFF on #054DBF → ~2.8:1.
        const freeze = await page.addStyleTag({
          content: `
            html body, html body * {
              transition: none !important;
            }
            html body .animate-fade-in-up, html body .animate-fade-in {
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
          const results = await new AxeBuilder({ page })
            .withRules(["color-contrast"])
            .analyze();

          const contrastViolations = results.violations.filter((v) => v.id === "color-contrast");
          expect(
            contrastViolations,
            `axe color-contrast failed on ${route} (${theme}): ${JSON.stringify(
              contrastViolations.map((v) => ({
                nodes: v.nodes.map((n) => ({
                  target: n.target,
                  summary: n.failureSummary,
                })),
              })),
            )}`,
          ).toEqual([]);
        } finally {
          await freeze.evaluate((el) => {
            if (el.parentNode) el.parentNode.removeChild(el);
          }).catch(() => undefined);
        }
      }

      for (const route of HEADER_ROUTES) {
        await page.goto(route, { waitUntil: "networkidle" });
        await setTheme(page, theme);
        await page.waitForTimeout(300);

        await assertPageTitleLayout(page, `${route} (${theme})`);

        const title = await sampleContrast(
          page,
          "main h1.page-title, main h2.page-title, main h1, main h2",
          { forcePixel: true },
        );
        expect(title, `missing title on ${route} (${theme})`).toBeTruthy();
        expect(
          title!.pass,
          `title contrast ${title!.ratio}:${title!.required} on ${route} (${theme}) color=${title!.color} bg=${JSON.stringify(title!.bg)} text=${title!.text}`,
        ).toBe(true);

        const subtitle = await sampleContrast(
          page,
          "main .page-subtitle, main h1 + p, main h2 + p",
          { forcePixel: true },
        );
        if (subtitle) {
          expect(
            subtitle.pass,
            `subtitle contrast ${subtitle.ratio}:${subtitle.required} on ${route} (${theme}) color=${subtitle.color} bg=${JSON.stringify(subtitle.bg)} text=${subtitle.text}`,
          ).toBe(true);
        }
      }

      // Settings + billing: no clipping / stacked title above subtitle
      for (const route of ["/es/settings", "/es/billing"] as const) {
        await page.goto(route, { waitUntil: "networkidle" });
        await setTheme(page, theme);
        await page.waitForTimeout(200);
        await assertPageTitleLayout(page, `${route} (${theme})`);
      }
    }

    // English sample after Spanish fixes
    await setTheme(page, "light");
    await page.goto("/en/dashboard", { waitUntil: "networkidle" });
    await setTheme(page, "light");
    const enTitle = await sampleContrast(page, "main h1.page-title, main h2.page-title, main h1, main h2");
    expect(enTitle?.pass).toBe(true);
  });

  // Plan-limit disabled "Add Beneficiary" — tokenised disabled styles must clear 4.5:1
  // (develop previously failed axe at ~1.35:1 with washed primary-on-primary).
  test("plan-limit disabled Add Beneficiary contrast (es, light + dark)", async ({
    page,
    user,
  }) => {
    test.setTimeout(180_000);

    await loginViaUi(page, user, "en");
    await createPinFromSecurityPage(page, PIN);
    const verifyPin = await page.request.post("/api/security/verify-pin", {
      headers: { "x-real-ip": `203.0.113.${140 + Math.floor(Math.random() * 40)}` },
      data: { pin: PIN },
    });
    expect(verifyPin.status()).toBe(200);

    // Free-trial default maxBeneficiaries is 2 — fill to the limit for this throwaway only.
    const stamp = Date.now();
    for (let i = 0; i < 2; i += 1) {
      const create = await page.request.post("/api/beneficiaries", {
        data: { full_name: `Limit Ben ${stamp}-${i}` },
      });
      expect(create.status(), `create beneficiary ${i}`).toBe(201);
    }

    for (const theme of ["light", "dark"] as const) {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto("/es/beneficiaries", { waitUntil: "load" });
      await setTheme(page, theme);
      await page.waitForTimeout(400);

      const disabledAdd = page.getByTestId("add-beneficiary-header");
      await expect(disabledAdd).toBeVisible({ timeout: 15_000 });
      await expect(disabledAdd).toBeDisabled();

      await page
        .evaluate(() => {
          (window as unknown as { __iableeToast?: { dismiss?: () => void } }).__iableeToast?.dismiss?.();
          document
            .querySelectorAll(
              "nextjs-portal, [data-next-badge], [data-nextjs-toast], #__next-build-watcher",
            )
            .forEach((el) => el.remove());
        })
        .catch(() => undefined);

      // Page-level axe (disabled controls are typically exempt, but catch any sibling failures).
      const results = await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze();
      const contrastViolations = results.violations.filter((v) => v.id === "color-contrast");
      expect(
        contrastViolations,
        `axe color-contrast failed on /es/beneficiaries plan-limit (${theme}): ${JSON.stringify(
          contrastViolations.map((v) => ({
            nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })),
          })),
        )}`,
      ).toEqual([]);

      const sample = await sampleContrast(page, '[data-testid="add-beneficiary-header"]', {
        forcePixel: true,
        sampleInside: true,
      });
      expect(sample, `missing disabled Add Beneficiary on /es/beneficiaries (${theme})`).toBeTruthy();
      expect(
        sample!.ratio,
        `disabled Add Beneficiary contrast ${sample!.ratio}:4.5 on /es/beneficiaries (${theme}) color=${sample!.color} bg=${JSON.stringify(sample!.bg)} text=${sample!.text}`,
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        sample!.pass,
        `disabled Add Beneficiary pass=${sample!.pass} ratio=${sample!.ratio}:${sample!.required} (${theme})`,
      ).toBe(true);
    }
  });

  // Landing is public — no throwaway user required. Premium CTA uses a fixed dark gradient.
  test("landing premium CTA contrast (es, light + dark)", async ({ page }) => {
    test.setTimeout(120_000);
    // Prior serial test may leave auth cookies; landing is for signed-out users.
    await page.context().clearCookies();

    for (const theme of ["light", "dark"] as const) {
      await page.goto("/es", { waitUntil: "domcontentloaded" });
      await setTheme(page, theme);
      await page.waitForTimeout(250);

      const premium = await sampleContrast(
        page,
        'main a[href*="auth/register"] button.btn-primary-gradient, main a[href*="auth/register"] button',
        { forcePixel: true, sampleInside: true },
      );
      expect(premium, `missing premium CTA on /es (${theme})`).toBeTruthy();
      expect(
        premium!.pass,
        `premium CTA contrast ${premium!.ratio}:${premium!.required} on /es (${theme}) color=${premium!.color} bg=${JSON.stringify(premium!.bg)} text=${premium!.text}`,
      ).toBe(true);
    }
  });
});
