import { expect, test } from "./fixtures/test";
import { loginViaUi } from "./fixtures/ui";

test.describe("01 auth", () => {
  test("redirects unauthenticated users to localized login pages", async ({ page }) => {
    await page.goto("/en/dashboard");
    await expect(page).toHaveURL(/\/en\/auth\/login/);

    await page.goto("/es/dashboard");
    await expect(page).toHaveURL(/\/es\/auth\/login/);
  });

  test("logs in and logs out with a throwaway confirmed user", async ({ page, user }) => {
    await loginViaUi(page, user, "en");
    await expect(page).toHaveURL(/\/en\/(wizard|dashboard)/);

    const response = await page.request.post("/api/auth/logout");
    expect(response.status()).toBe(200);
    const body = (await response.json()) as { success?: boolean };
    expect(body.success).toBe(true);
    await page.goto("/en/dashboard");
    await expect(page).toHaveURL(/\/en\/auth\/login/);
  });

  test("submits register UI flow stub without sending real email", async ({ page }) => {
    await page.route("**/api/auth/register", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true }),
      });
    });

    await page.goto("/en/auth/register");
    await page.getByLabel(/full name/i).fill("E2E Register");
    await page.getByLabel(/email/i).fill("e2e-register@iablee.test");
    await page.getByLabel(/password/i).fill("Password123!");
    await page.getByRole("button", { name: /create account/i }).click();

    await expect(page).toHaveURL(/\/en\/auth\/login\?registered=true/);
  });

  test("validates register backend input without triggering outbound email", async ({ page }) => {
    const response = await page.request.post("/api/auth/register", {
      data: {
        email: "",
        password: "",
        locale: "en",
      },
    });

    expect(response.status()).toBe(400);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toBe("Email and password are required");
  });
});
