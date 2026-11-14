import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures/test";
import { createPinFromSecurityPage, loginViaUi } from "./fixtures/ui";
import { sampleContrast, setTheme } from "./lib/contrast";

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
        await page.waitForTimeout(250);

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
      }

      for (const route of HEADER_ROUTES) {
        await page.goto(route, { waitUntil: "networkidle" });
        await setTheme(page, theme);
        await page.waitForTimeout(300);

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
    }

    // English sample after Spanish fixes
    await setTheme(page, "light");
    await page.goto("/en/dashboard", { waitUntil: "networkidle" });
    await setTheme(page, "light");
    const enTitle = await sampleContrast(page, "main h1.page-title, main h2.page-title, main h1, main h2");
    expect(enTitle?.pass).toBe(true);
  });
});
