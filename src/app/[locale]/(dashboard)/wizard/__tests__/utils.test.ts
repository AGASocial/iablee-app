import type { AssetType } from "@/lib/assetTypes";
import { File, Mail } from "lucide-react";
import {
  buildWizardDraft,
  getAssetIcon,
  sanitizeDraftCustomFields,
  validateAssetDetails,
  validateAssetType,
  validateBeneficiary,
} from "../utils";

const baseAssetData = {
  assetType: "",
  assetName: "",
  description: "",
  website: "",
  validUntil: "",
  email: "",
  password: "",
  customFields: {},
};

const baseBeneficiary = {
  fullName: "",
  email: "",
  relationshipId: null,
  phoneNumber: "",
  notes: "",
};

const assetTypeWithRequiredFields: AssetType = {
  id: "1",
  key: "document",
  label: "document",
  icon: "File",
  requiredFields: ["email", "valid_until"],
  optionalFields: [],
  customFields: [{ key: "docCode", label: "docCode", type: "text", required: true }],
  displayOrder: 1,
  isActive: true,
};

describe("wizard validation utilities", () => {
  it("requires asset type selection", () => {
    expect(validateAssetType(baseAssetData).assetType).toBe("wizard-validation-asset-type-required");
  });

  it("validates required asset detail fields and custom fields", () => {
    const errors = validateAssetDetails(baseAssetData, assetTypeWithRequiredFields);
    expect(errors.assetName).toBe("wizard-validation-required");
    expect(errors.email).toBe("wizard-validation-required");
    expect(errors.validUntil).toBe("wizard-validation-required");
    expect(errors["custom:docCode"]).toBe("wizard-validation-required");
  });

  it("validates email format for asset and beneficiary", () => {
    const assetErrors = validateAssetDetails(
      { ...baseAssetData, assetType: "document", assetName: "Docs", email: "not-an-email" },
      null,
    );
    expect(assetErrors.email).toBe("wizard-validation-email");

    const beneficiaryErrors = validateBeneficiary({ ...baseBeneficiary, email: "broken", fullName: "Ana", relationshipId: 3 });
    expect(beneficiaryErrors.email).toBe("wizard-validation-email");
  });

  it("returns no errors for a complete beneficiary", () => {
    const errors = validateBeneficiary({
      ...baseBeneficiary,
      fullName: "Ana Example",
      email: "ana@example.com",
      relationshipId: 2,
    });
    expect(errors).toEqual({});
  });

  it("falls back to default icon when icon key is unknown", () => {
    expect(getAssetIcon("SomethingElse")).toBe(File);
    expect(getAssetIcon("Mail")).toBe(Mail);
  });

  it("does not include password or sensitive custom fields in draft payload", () => {
    const assetType: AssetType = {
      ...assetTypeWithRequiredFields,
      customFields: [
        { key: "public_note", label: "notes", type: "text" },
        { key: "secret_hint", label: "Secret key", type: "text" },
      ],
    };
    const draft = buildWizardDraft({
      userId: "user-1",
      step: "asset-details",
      assetType,
      assetData: {
        ...baseAssetData,
        password: "never-store-this",
        customFields: {
          public_note: "visible",
          secret_hint: "top-secret",
        },
      },
      beneficiaryData: baseBeneficiary,
    });

    expect(draft.asset).not.toHaveProperty("password");
    expect(draft.asset.customFields).toEqual({ public_note: "visible" });
  });

  it("keeps non-sensitive custom fields in draft payload", () => {
    expect(
      sanitizeDraftCustomFields(
        {
          favorite_color: "blue",
          contact_name: "Ana",
        },
        assetTypeWithRequiredFields,
      ),
    ).toEqual({
      favorite_color: "blue",
      contact_name: "Ana",
    });
  });
});
