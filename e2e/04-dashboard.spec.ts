import { expect, test } from "./fixtures/test";
import { loginViaUi } from "./fixtures/ui";

test.describe("04 dashboard", () => {
  test("shows empty-state checklist with three onboarding steps", async ({ page, user }) => {
    await loginViaUi(page, user);
    await page.goto("/en/dashboard");
    const checklist = page.getByLabel(/dashboard setup checklist/i);

    await expect(page.getByRole("heading", { name: /get your dashboard ready/i })).toBeVisible();
    await expect(checklist.getByText(/create your pin/i)).toBeVisible();
    await expect(checklist.getByText(/add your first asset/i)).toBeVisible();
    await expect(checklist.getByText(/add your first beneficiary/i)).toBeVisible();
    await expect(page.getByRole("link", { name: /create your pin/i })).toBeVisible();
  });
});
