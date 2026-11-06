import { expect, test } from "./fixtures/test";
import { createPinFromSecurityPage, loginViaUi } from "./fixtures/ui";

const PIN = "123456";

test.describe("06 beneficiaries CRUD + assign to asset", () => {
  test("creates, edits, assigns, and deletes beneficiary", async ({ page, user }) => {
    const beneficiaryName = `Beneficiary ${Date.now()}`;
    const updatedName = `${beneficiaryName} Updated`;
    const assetName = `Asset for assign ${Date.now()}`;

    await loginViaUi(page, user);
    await createPinFromSecurityPage(page, PIN);
    const verifyPin = await page.request.post("/api/security/verify-pin", {
      headers: {
        "x-real-ip": "203.0.113.57",
      },
      data: { pin: PIN },
    });
    expect(verifyPin.status()).toBe(200);

    const assetTypesResponse = await page.request.get("/api/asset-types");
    const assetTypes = (await assetTypesResponse.json()) as Array<{ key: string }>;
    expect(assetTypes.length).toBeGreaterThan(0);

    const createAssetResponse = await page.request.post("/api/assets", {
      data: {
        asset_type: assetTypes[0].key,
        asset_name: assetName,
      },
    });
    expect(createAssetResponse.status()).toBe(201);
    const createdAsset = (await createAssetResponse.json()) as { id?: string };
    const createdAssetId = createdAsset.id;
    expect(createdAssetId).toBeTruthy();

    await page.goto("/en/digital-assets");
    await expect(page.getByRole("button", { name: /add new asset/i })).toBeVisible();

    await page.goto("/en/beneficiaries");
    await page.getByRole("button", { name: /^add beneficiary$/i }).click();
    await page.locator("#full_name").fill(beneficiaryName);
    await page.getByRole("button", { name: /^save$/i }).click();
    await expect(page.getByText(beneficiaryName)).toBeVisible();

    const beneficiaryCard = page.locator(`div:has(h3:has-text("${beneficiaryName}"))`).first();
    await beneficiaryCard.hover();
    await beneficiaryCard.locator('button[title="Edit"], button[title="Editar"]').click();
    await page.locator("#full_name").fill(updatedName);
    await page.getByRole("button", { name: /^save$/i }).click();
    await expect(page.getByText(updatedName)).toBeVisible();

    const beneficiariesResponse = await page.request.get("/api/beneficiaries");
    const beneficiariesBody = (await beneficiariesResponse.json()) as {
      data: Array<{ id: string; full_name: string }>;
    };
    const updatedBeneficiary = beneficiariesBody.data.find((entry) => entry.full_name === updatedName);
    expect(updatedBeneficiary?.id).toBeTruthy();

    const assignResponse = await page.request.put(`/api/assets/${createdAssetId}`, {
      data: { beneficiary_id: updatedBeneficiary?.id },
    });
    expect(assignResponse.status()).toBe(200);

    const unassignResponse = await page.request.put(`/api/assets/${createdAssetId}`, {
      data: { beneficiary_id: null },
    });
    expect(unassignResponse.status()).toBe(200);

    await page.goto("/en/beneficiaries");
    const removableCard = page.locator(`div:has(h3:has-text("${updatedName}"))`).first();
    await removableCard.hover();
    await removableCard.locator('button[title="Delete"], button[title="Eliminar"]').click();
    await page.getByRole("button", { name: /^delete$/i }).last().click();
    await expect(page.getByText(updatedName)).not.toBeVisible();
  });
});
