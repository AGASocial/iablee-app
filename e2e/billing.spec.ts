import { expect, test } from "./fixtures/test";
import { loginViaUi } from "./fixtures/ui";

test.describe("09 billing", () => {
  test("cancels and resumes subscription through intercepted billing APIs (no provider side effects)", async ({
    page,
    user,
  }) => {
    await loginViaUi(page, user);

    let cancelAtPeriodEnd = false;
    let deleteRequests = 0;
    let patchRequests = 0;

    await page.route("**/api/billing/subscriptions*", async (route) => {
      const request = route.request();
      const method = request.method();

      if (method === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            subscription: {
              id: "sub_e2e_123",
              userId: user.id,
              planId: "plan_premium",
              status: "active",
              currentPeriodEnd: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
              cancelAtPeriodEnd,
              plan: {
                id: "plan_premium",
                name: "Premium",
                currency: "USD",
                amountCents: 2900,
                interval: "month",
                features: {
                  max_assets: -1,
                  max_beneficiaries: -1,
                  max_storage_mb: 10000,
                  priority_support: true,
                },
              },
            },
            config: { provider: "stripe" },
          }),
        });
        return;
      }

      if (method === "DELETE") {
        const url = new URL(request.url());
        expect(url.searchParams.get("subscriptionId")).toBe("sub_e2e_123");
        expect(url.searchParams.get("atPeriodEnd")).toBe("true");
        deleteRequests += 1;
        cancelAtPeriodEnd = true;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ success: true }),
        });
        return;
      }

      if (method === "PATCH") {
        patchRequests += 1;
        const body = request.postDataJSON() as { subscriptionId?: string; cancelAtPeriodEnd?: boolean };
        expect(body.subscriptionId).toBe("sub_e2e_123");
        expect(body.cancelAtPeriodEnd).toBe(false);
        cancelAtPeriodEnd = false;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ success: true }),
        });
        return;
      }

      await route.fallback();
    });

    await page.route("**/api/billing/invoices*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ invoices: [] }),
      });
    });

    await page.route("**/api/subscription/status*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          plan: "premium",
          limits: { maxAssets: -1, maxBeneficiaries: -1, maxStorageMb: 10000 },
          usage: { assetsCount: 0, beneficiariesCount: 0, storageUsedMb: 0 },
          canCreateAsset: true,
          canCreateBeneficiary: true,
        }),
      });
    });

    page.once("dialog", async (dialog) => {
      expect(dialog.message()).toContain("cancel");
      await dialog.accept();
    });

    await page.goto("/en/billing");
    await expect(page.getByRole("heading", { name: /billing dashboard/i })).toBeVisible();

    const cancelButton = page.getByRole("button", { name: /cancel subscription/i });
    await expect(cancelButton).toBeVisible();
    await cancelButton.click();

    await expect(page.getByText(/subscription canceled successfully/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /resume subscription/i })).toBeVisible();
    expect(deleteRequests).toBe(1);

    const resumeButton = page.getByRole("button", { name: /resume subscription/i });
    await resumeButton.click();

    await expect(page.getByText(/subscription resumed successfully/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /cancel subscription/i })).toBeVisible();
    expect(patchRequests).toBe(1);
  });

  test("validates billing backend guards without creating real subscription", async ({ page, user }) => {
    const unauthenticated = await page.request.post("/api/billing/subscriptions", {
      data: {},
    });
    expect(unauthenticated.status()).toBe(401);
    const unauthenticatedBody = (await unauthenticated.json()) as { error?: string };
    expect(unauthenticatedBody.error).toBe("Unauthorized");

    await loginViaUi(page, user);

    const missingPlan = await page.request.post("/api/billing/subscriptions", {
      data: {},
    });
    expect(missingPlan.status()).toBe(400);
    const missingPlanBody = (await missingPlan.json()) as { error?: string };
    expect(missingPlanBody.error).toBe("Plan ID is required");

    const missingPatchSubscriptionId = await page.request.patch("/api/billing/subscriptions", {
      data: { cancelAtPeriodEnd: false },
    });
    expect(missingPatchSubscriptionId.status()).toBe(400);
    const missingPatchBody = (await missingPatchSubscriptionId.json()) as { error?: string };
    expect(missingPatchBody.error).toBe("Subscription ID is required");

    const missingDeleteSubscriptionId = await page.request.delete("/api/billing/subscriptions");
    expect(missingDeleteSubscriptionId.status()).toBe(400);
    const missingDeleteBody = (await missingDeleteSubscriptionId.json()) as { error?: string };
    expect(missingDeleteBody.error).toBe("Subscription ID is required");
  });
});



