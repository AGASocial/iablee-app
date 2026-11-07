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

  test("keeps dashboard-related API calls bounded during same-session navigation", async ({ page, user }) => {
    let totalApiCalls = 0;
    let dashboardCalls = 0;
    let checkSessionCalls = 0;
    const pathCounts = new Map<string, number>();

    page.on("request", (request) => {
      const url = request.url();
      if (url.includes("/api/")) {
        totalApiCalls += 1;
        const pathname = new URL(url).pathname;
        pathCounts.set(pathname, (pathCounts.get(pathname) ?? 0) + 1);
      }
      if (url.includes("/api/dashboard")) {
        dashboardCalls += 1;
      }
      if (url.includes("/api/security/check-session")) {
        checkSessionCalls += 1;
      }
    });

    await loginViaUi(page, user);
    await page.goto("/en/dashboard");
    await page.waitForURL(/\/en\/dashboard/);
    await expect(page.getByRole("heading", { name: /get your dashboard ready/i })).toBeVisible();

    totalApiCalls = 0;
    dashboardCalls = 0;
    checkSessionCalls = 0;
    pathCounts.clear();

    await page.reload();
    await expect(page.getByRole("heading", { name: /get your dashboard ready/i })).toBeVisible();
    expect(dashboardCalls).toBeLessThanOrEqual(1);
    expect(totalApiCalls, JSON.stringify(Object.fromEntries(pathCounts.entries()))).toBeLessThanOrEqual(5);

    const checkSessionAfterFirstVisit = checkSessionCalls;

    await page.getByRole("link", { name: /beneficiaries/i }).first().click();
    await page.waitForURL(/\/en\/beneficiaries/);
    await page.goBack();
    await page.waitForURL(/\/en\/dashboard/);

    // Client-side cached navigation should not trigger extra check-session calls.
    expect(checkSessionCalls - checkSessionAfterFirstVisit).toBe(0);
  });
});
