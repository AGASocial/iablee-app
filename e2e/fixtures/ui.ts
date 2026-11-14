import type { Locator, Page } from "@playwright/test";
import type { E2EUser } from "./supabase";

export async function loginViaUi(page: Page, user: E2EUser, locale: "en" | "es" = "en"): Promise<void> {
  await page.goto(`/${locale}/auth/login`);
  await page.getByLabel(/email/i).fill(user.email);
  await page.locator('input[type="password"]').fill(user.password);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL(new RegExp(`/${locale}/(wizard|dashboard)`), { timeout: 20000 });
}

export async function openProfileMenu(page: Page): Promise<void> {
  const desktopTrigger = page.getByRole("button", { name: /profile/i }).first();
  await desktopTrigger.click({ force: true });
}

export async function signOut(page: Page): Promise<void> {
  await openProfileMenu(page);
  await page.getByRole("menuitem", { name: /sign out|cerrar sesión/i }).click();
}

export async function fillPinInputs(container: Page | Locator, pin: string): Promise<void> {
  const inputs = container.locator('input[inputmode="numeric"]');
  const count = await inputs.count();
  if (count < pin.length) {
    throw new Error(`Expected at least ${pin.length} PIN inputs, found ${count}`);
  }

  for (let i = 0; i < pin.length; i += 1) {
    await inputs.nth(i).fill(pin[i] ?? "");
  }
}

export async function fillPinGroup(page: Page, pin: string, groupIndex: number): Promise<void> {
  const inputs = page.locator('input[inputmode="numeric"]');
  const start = groupIndex * pin.length;
  for (let i = 0; i < pin.length; i += 1) {
    await inputs.nth(start + i).fill(pin[i] ?? "");
  }
}

export async function createPinFromSecurityPage(page: Page, pin: string): Promise<void> {
  await page.goto("/en/settings/security");
  await page.getByRole("button", { name: /change security pin/i }).first().click();
  await fillPinGroup(page, pin, 0);
  await fillPinGroup(page, pin, 1);
  const pinRequest = page.waitForResponse((response) => {
    const url = response.url();
    return url.includes("/api/security/set-pin") || url.includes("/api/security/change-pin");
  });
  await page.getByRole("button", { name: /change security pin/i }).last().click();
  const pinResponse = await pinRequest;
  if (!pinResponse.ok()) {
    throw new Error(`Unable to set/change security pin, status ${pinResponse.status()}`);
  }
}

export async function unlockProtectedAreaWithPin(page: Page, pin: string): Promise<void> {
  await fillPinInputs(page, pin);
  await page.waitForTimeout(250);
}

export async function resolveSecurityPinDialog(page: Page, pin: string): Promise<void> {
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ state: "visible" });
  const title = ((await dialog.getByRole("heading").first().textContent()) ?? "").toLowerCase();

  await fillPinInputs(dialog, pin);
  if (title.includes("create") || title.includes("crear")) {
    await fillPinInputs(dialog, pin);
  }
}
