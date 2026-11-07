import { expect, test } from "./fixtures/test";
import { getSupabaseAdmin } from "./fixtures/supabase";
import { createPinFromSecurityPage, loginViaUi, signOut } from "./fixtures/ui";

const PIN = "123456";

test.describe("07 Soy beneficiario de", () => {
  test("shows user B as beneficiary of user A asset relationship", async ({ page, user, createUser }) => {
    const owner = user;
    const beneficiaryUser = await createUser();
    const admin = getSupabaseAdmin();

    const { data: relationships } = await admin
      .from("relationships")
      .select("id")
      .order("id", { ascending: true })
      .limit(1);
    expect((relationships ?? []).length).toBeGreaterThan(0);

    const { data: insertedBeneficiary, error: beneficiaryError } = await admin
      .from("beneficiaries")
      .insert({
        user_id: owner.id,
        full_name: "Cross User Beneficiary",
        email: beneficiaryUser.email,
        relationship_id: relationships?.[0]?.id ?? null,
        email_verified: true,
        email_verified_at: new Date().toISOString(),
        status: "active",
      })
      .select("id")
      .single();
    expect(beneficiaryError).toBeNull();
    expect(insertedBeneficiary?.id).toBeTruthy();

    const { data: assetTypes } = await admin
      .from("asset_types")
      .select("key")
      .order("display_order", { ascending: true })
      .limit(1);
    expect((assetTypes ?? []).length).toBeGreaterThan(0);

    const { error: assetError } = await admin.from("digital_assets").insert({
      user_id: owner.id,
      asset_type: assetTypes?.[0]?.key ?? "letter",
      asset_name: "Cross-user relationship asset",
      beneficiary_id: insertedBeneficiary?.id,
      status: "assigned",
    });
    expect(assetError).toBeNull();

    await loginViaUi(page, beneficiaryUser);
    await createPinFromSecurityPage(page, PIN);
    const verifyPin = await page.request.post("/api/security/verify-pin", {
      headers: {
        "x-real-ip": "203.0.113.58",
      },
      data: { pin: PIN },
    });
    expect(verifyPin.status()).toBe(200);

    await page.goto("/en/my-beneficiary-relationships");
    await expect(page).toHaveURL(/\/en\/my-beneficiary-relationships/);
    await expect(page.getByText(owner.fullName)).toBeVisible();

    await signOut(page);
  });
});
