import { expect, test } from "./fixtures/test";
import { createPinFromSecurityPage, loginViaUi, resolveSecurityPinDialog } from "./fixtures/ui";

const PIN = "123456";

test.describe("03 wizard", () => {
  test("completes full 3-step wizard flow", async ({ page, user }) => {
    await loginViaUi(page, user);
    await createPinFromSecurityPage(page, PIN);

    await page.goto("/en/wizard");
    await page.getByRole("button", { name: /^start$/i }).click();
    await page.locator('[data-asset-type-option="true"]').first().click();
    await page.getByRole("button", { name: /^next$/i }).click();

    await page.locator("#asset-name").fill("Wizard Asset One");
    await page.locator("#asset-description").fill("Asset created from wizard full flow test");
    await page.getByRole("button", { name: /more options/i }).click();
    await page.getByRole("textbox", { name: /write here what you want to say/i }).fill(
      "Message required to continue wizard step",
    );
    await page.getByRole("button", { name: /^next$/i }).click();

    await page.locator("#beneficiary-name").fill("Wizard Beneficiary");
    await page.locator("#beneficiary-relationship").click();
    await page.getByRole("option").first().click();
    await page.getByRole("button", { name: /^save$/i }).click();

    await resolveSecurityPinDialog(page, PIN);
    await expect(page.getByRole("button", { name: /^save$/i })).not.toBeVisible();
  });

  test("restores draft with Continuar donde lo dejaste after reload", async ({ page, user }) => {
    await loginViaUi(page, user, "es");

    await page.goto("/es/wizard");
    await page.getByRole("button", { name: /^empezar$/i }).click();
    await page.locator('[data-asset-type-option="true"]').first().click();
    await page.getByRole("button", { name: /^siguiente$/i }).click();
    await page.locator("#asset-name").fill("Activo borrador");

    await page.reload();
    const continueButton = page.getByRole("button", { name: /^continuar$/i });
    await expect(page.getByText("Continuar donde lo dejaste")).toBeVisible();
    await expect(continueButton).toBeVisible();
    await continueButton.click();
  });

  test("keeps wizard completion idempotent on retry", async ({ page, user }) => {
    await loginViaUi(page, user);
    await createPinFromSecurityPage(page, PIN);

    const verifyResponse = await page.request.post("/api/security/verify-pin", {
      headers: {
        "x-real-ip": "203.0.113.56",
      },
      data: { pin: PIN },
    });
    expect(verifyResponse.status()).toBe(200);

    const relationshipResponse = await page.request.get("/api/relationships");
    expect(relationshipResponse.status()).toBe(200);
    const relationships = (await relationshipResponse.json()) as Array<{ id: number }>;
    expect(relationships.length).toBeGreaterThan(0);

    const assetTypesResponse = await page.request.get("/api/asset-types");
    expect(assetTypesResponse.status()).toBe(200);
    const assetTypes = (await assetTypesResponse.json()) as Array<{ key: string }>;
    expect(assetTypes.length).toBeGreaterThan(0);

    const uniqueName = `Idempotent Wizard Asset ${Date.now()}`;
    const idempotencyKey = `e2e-wizard-${Date.now()}`;
    const payload = {
      asset: {
        assetType: assetTypes[0].key,
        assetName: uniqueName,
        description: "Idempotency validation asset",
      },
      beneficiary: {
        fullName: "Idempotent Beneficiary",
        relationshipId: relationships[0].id,
      },
      fileUrls: [],
      fileMetadata: [],
      locale: "en",
      idempotencyKey,
    };

    const first = await page.request.post("/api/wizard/complete", {
      headers: { "Idempotency-Key": idempotencyKey },
      data: payload,
    });
    expect(first.status()).toBe(201);

    const second = await page.request.post("/api/wizard/complete", {
      headers: { "Idempotency-Key": idempotencyKey },
      data: payload,
    });
    expect(second.status()).toBe(200);
    const secondBody = (await second.json()) as { idempotent?: boolean };
    expect(secondBody.idempotent).toBe(true);

    const assetsResponse = await page.request.get("/api/assets");
    const assetsBody = (await assetsResponse.json()) as {
      data: Array<{ asset_name: string }>;
    };
    const matches = assetsBody.data.filter((asset) => asset.asset_name === uniqueName);
    expect(matches).toHaveLength(1);
  });
});
