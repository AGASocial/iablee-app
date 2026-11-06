import { expect, test } from "./fixtures/test";
import { getUserPinState } from "./fixtures/supabase";
import { createPinFromSecurityPage, loginViaUi } from "./fixtures/ui";

const INITIAL_PIN = "123456";
const CHANGED_PIN = "654321";

test.describe("02 pin", () => {
  test("creates pin from settings and stores it", async ({ page, user }) => {
    await loginViaUi(page, user);
    await createPinFromSecurityPage(page, INITIAL_PIN);

    const state = await getUserPinState(user.id);
    expect(state.hasPin).toBeTruthy();
  });

  test("handles wrong pin and supports pin change", async ({ page, user }) => {
    await loginViaUi(page, user);
    await createPinFromSecurityPage(page, INITIAL_PIN);

    const wrongPin = await page.request.post("/api/security/verify-pin", {
      data: { pin: "000000" },
    });
    expect(wrongPin.status()).not.toBe(200);

    const changePin = await page.request.post("/api/security/change-pin", {
      data: { currentPin: INITIAL_PIN, newPin: CHANGED_PIN },
    });
    expect(changePin.status()).toBe(200);

    const verifyChanged = await page.request.post("/api/security/verify-pin", {
      data: { pin: CHANGED_PIN },
    });
    expect(verifyChanged.status()).toBe(200);
  });

  test("returns lockout and 429 after repeated verify attempts", async ({ page, user }) => {
    await loginViaUi(page, user);
    await createPinFromSecurityPage(page, INITIAL_PIN);

    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      const response = await page.request.post("/api/security/verify-pin", {
        headers: {
          "x-real-ip": "203.0.113.99",
        },
        data: { pin: "000000" },
      });
      statuses.push(response.status());
    }

    expect(statuses.some((status) => status === 423 || status === 429)).toBeTruthy();
    expect(statuses[5]).toBe(429);
  });
});
