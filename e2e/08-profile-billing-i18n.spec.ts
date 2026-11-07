import { expect, test } from "./fixtures/test";
import { loginViaUi } from "./fixtures/ui";

test.describe("08 profile + billing/plans + i18n smoke", () => {
  test("updates profile and loads billing/plans in en and es", async ({ page, user }) => {
    const updatedName = `${user.fullName} Updated`;

    await loginViaUi(page, user);

    await page.goto("/en/settings");
    await expect(page.getByRole("heading", { name: /profile/i })).toBeVisible();
    await page.locator("#fullName").fill(updatedName);
    await page.getByRole("button", { name: /^save$/i }).first().click();
    await expect(page.locator("#fullName")).toHaveValue(updatedName);

    await page.goto("/en/billing");
    await expect(page.getByRole("heading", { name: /billing dashboard/i })).toBeVisible();

    await page.goto("/en/billing/plans");
    await expect(page.getByRole("heading", { name: /pricing/i })).toBeVisible();
    await expect(page.getByText(/premium|free/i).first()).toBeVisible();

    await page.goto("/es/billing/plans");
    await expect(page.getByRole("heading", { name: /precios/i })).toBeVisible();

    await page.goto("/es/settings");
    await expect(page.getByRole("heading", { name: /perfil/i })).toBeVisible();
  });
});
