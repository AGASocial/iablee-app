import { expect, test } from "./fixtures/test";
import { createPinFromSecurityPage, loginViaUi } from "./fixtures/ui";

const PIN = "123456";

test.describe("05 digital assets CRUD + attachment upload", () => {
  test("creates, edits, manages attachments, and deletes an asset", async ({ page, user }) => {
    const initialName = `Asset ${Date.now()}`;
    const updatedName = `${initialName} Updated`;

    await loginViaUi(page, user);
    await createPinFromSecurityPage(page, PIN);
    const verifyPin = await page.request.post("/api/security/verify-pin", {
      headers: {
        "x-real-ip": "203.0.113.55",
      },
      data: { pin: PIN },
    });
    expect(verifyPin.status()).toBe(200);

    await page.goto("/en/digital-assets");
    await expect(page.getByRole("button", { name: /add new asset/i })).toBeEnabled();

    await page.getByRole("button", { name: /add new asset/i }).click();
    await page.getByRole("button", { name: /document/i }).first().click();

    await page.locator("#asset_name").fill(initialName);
    const writeMessage = page.getByRole("textbox", { name: /write here what you want to say/i });
    if (await writeMessage.count()) {
      await writeMessage.fill("E2E asset message");
    }
    await page.getByRole("button", { name: /^save$/i }).click();

    await expect(page.getByText(initialName)).toBeVisible();

    await page.getByText(initialName).first().click();
    const editButton = page.locator('button[title="Edit"], button[title="Editar"]').first();
    await editButton.click();
    await page.locator("#asset_name").fill(updatedName);
    const updateMessage = page.getByRole("textbox", { name: /write here what you want to say/i });
    if (await updateMessage.count()) {
      await updateMessage.fill("Updated E2E asset message");
    }
    await page.getByRole("button", { name: /^save$/i }).click();
    await expect(page.getByRole("heading", { name: updatedName })).toBeVisible();

    await page.getByRole("button", { name: /manage files/i }).click();
    await page.locator("#file-upload").setInputFiles({
      name: "asset-note.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("playwright attachment upload", "utf-8"),
    });
    await expect(page.getByText(/1 files attached|1 files/i)).toBeVisible();
    await page.keyboard.press("Escape");

    await page.getByText(updatedName).first().click();
    await page.getByRole("button", { name: /^delete$/i }).first().click();
    await page.getByRole("button", { name: /^delete$/i }).last().click();
    await expect(page.getByText(updatedName)).not.toBeVisible();
  });
});
