import type { Locator, Page } from "@playwright/test";
import type { E2EUser } from "./supabase";

export async function loginViaUi(page: Page, user: E2EUser, locale: "en" | "es" = "en"): Promise<void> {
  // Bypass the in-memory login limiter (10/min per IP; local IP is often "unknown")
  // without weakening production — unique TEST-ONLY x-real-ip per login attempt.
  const loginRoute = "**/api/auth/login";
  let loginIp = `203.0.113.${100 + Math.floor(Math.random() * 100)}`;
  await page.route(loginRoute, async (route) => {
    const headers = {
      ...route.request().headers(),
      "x-real-ip": loginIp,
    };
    await route.continue({ headers });
  });

  const attempt = async () => {
    loginIp = `203.0.113.${100 + Math.floor(Math.random() * 100)}`;
    // Prefer load over domcontentloaded so client handlers hydrate before submit
    // (unhydrated <form> would GET and leak credentials into the query string;
    // method="post" is a hard fallback, but the JS path still needs hydration).
    await page.goto(`/${locale}/auth/login`, { waitUntil: "load" });
    await page.waitForLoadState("networkidle").catch(() => undefined);
    const form = page.locator('form[method="post"]').first();
    await form.waitFor({ state: "visible", timeout: 15_000 });
    // Wait until React has attached the submit handler (button leaves SSR-only state).
    const email = page.getByLabel(/email/i);
    await email.waitFor({ state: "visible" });
    await email.fill(user.email);
    await page.locator('input[type="password"]').fill(user.password);
    const submit = form.locator('button[type="submit"]').first();
    await submit.waitFor({ state: "visible" });
    await expectEnabled(submit);
    await Promise.all([
      page.waitForURL(new RegExp(`/${locale}/(wizard|dashboard)`), { timeout: 30_000 }),
      submit.click(),
    ]);
  };

  try {
    try {
      await attempt();
    } catch {
      // One retry for intermittent auth/network races (and Supabase soft rate-limits).
      await page.waitForTimeout(2_000);
      await attempt();
    }
  } finally {
    await page.unroute(loginRoute).catch(() => undefined);
  }
}

async function expectEnabled(locator: Locator): Promise<void> {
  await locator.waitFor({ state: "visible" });
  // Soft readiness: ensure the control is interactable after hydration.
  for (let i = 0; i < 20; i += 1) {
    if (await locator.isEnabled().catch(() => false)) return;
    await locator.page().waitForTimeout(100);
  }
}

export async function openProfileMenu(page: Page): Promise<void> {
  const desktopTrigger = page
    .getByRole("button", { name: /profile|perfil|account|cuenta|user|usuario/i })
    .first();
  await desktopTrigger.click({ force: true, timeout: 15_000 });
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
