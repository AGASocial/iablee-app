import type { AssetType } from "@/lib/assetTypes";
import { File, Mail } from "lucide-react";
import {
  buildWizardDraft,
  buildWizardCompletionFingerprint,
  getAssetIcon,
  parseWizardDraft,
  resolveWizardCompletionAttemptKey,
  sanitizeDraftCustomFields,
  submitWizardCompleteWithRetry,
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
        { key: "safe_date", label: "Safe date", type: "date" },
        { key: "pin_code", label: "Pin code", type: "number" },
        { key: "pinCode", label: "Pin code camel", type: "number" },
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
          safe_date: "2026-11-05",
          pin_code: "1234",
          pinCode: "5678",
          unknown_field: "should-be-removed",
        },
      },
      beneficiaryData: baseBeneficiary,
    });

    expect(draft.asset).not.toHaveProperty("password");
    expect(draft.asset.customFields).toEqual({
      public_note: "visible",
      safe_date: "2026-11-05",
    });
  });

  it("keeps non-sensitive custom fields in draft payload", () => {
    const assetType: AssetType = {
      ...assetTypeWithRequiredFields,
      customFields: [
        { key: "favorite_color", label: "Favorite color", type: "text" },
        { key: "contact_name", label: "Contact name", type: "text" },
      ],
    };

    expect(
      sanitizeDraftCustomFields(
        {
          favorite_color: "blue",
          contact_name: "Ana",
        },
        assetType,
      ),
    ).toEqual({
      favorite_color: "blue",
      contact_name: "Ana",
    });
  });

  it("does not treat every field containing 'key' as sensitive", () => {
    const assetType: AssetType = {
      ...assetTypeWithRequiredFields,
      customFields: [{ key: "monkey_name", label: "Monkey Name", type: "text" }],
    };

    expect(
      sanitizeDraftCustomFields(
        {
          monkey_name: "Bongo",
        },
        assetType,
      ),
    ).toEqual({
      monkey_name: "Bongo",
    });
  });

  it("drops fields with disallowed types, including password", () => {
    const assetType: AssetType = {
      ...assetTypeWithRequiredFields,
      customFields: [
        { key: "public_url", label: "Public URL", type: "url" },
        { key: "public_number", label: "Public Number", type: "number" },
        { key: "bio", label: "Bio", type: "textarea" },
        { key: "document_file", label: "Document", type: "file" },
        { key: "typed_password", label: "Password", type: "password" },
      ],
    };

    expect(
      sanitizeDraftCustomFields(
        {
          public_url: "https://example.com",
          public_number: "42",
          bio: "hello",
          document_file: "private.pdf",
          typed_password: "never-save",
        },
        assetType,
      ),
    ).toEqual({
      public_url: "https://example.com",
      public_number: "42",
      bio: "hello",
    });
  });

  it("returns an empty object when there is no asset type definition", () => {
    expect(
      sanitizeDraftCustomFields(
        {
          any_field: "value",
          another: "value-2",
        },
        null,
      ),
    ).toEqual({});
  });

  it("re-sanitizes draft custom fields on parse to avoid trusting localStorage", () => {
    const assetType: AssetType = {
      ...assetTypeWithRequiredFields,
      customFields: [
        { key: "safe_note", label: "Safe note", type: "text" },
        { key: "safe_date", label: "Safe date", type: "date" },
        { key: "secret_hint", label: "Secret hint", type: "text" },
        { key: "upload", label: "Upload", type: "file" },
      ],
    };
    const raw = JSON.stringify({
      version: 1,
      userId: "user-1",
      step: "asset-details",
      asset: {
        assetType: "document",
        assetName: "Docs",
        description: "",
        website: "",
        validUntil: "",
        email: "",
        customFields: {
          safe_note: "keep",
          safe_date: "2026-11-05",
          secret_hint: "drop",
          upload: "drop",
          unknown_field: "drop",
          not_a_string: { nested: true },
        },
      },
      beneficiary: {
        fullName: "Ana",
        email: "",
        relationshipId: null,
        phoneNumber: "",
        notes: "",
      },
    });

    const parsed = parseWizardDraft(raw, "user-1", [assetType]);

    expect(parsed?.asset.customFields).toEqual({
      safe_note: "keep",
      safe_date: "2026-11-05",
    });
  });

  describe("submitWizardCompleteWithRetry", () => {
    let originalFetch: typeof fetch;
    let fetchMock: jest.Mock;

    function makeMockResponse(
      status: number,
      body: { error?: string; retryable?: boolean; ok?: boolean },
    ): Response {
      return {
        status,
        clone() {
          return this as Response;
        },
        json: async () => body,
      } as unknown as Response;
    }

    const payload = {
      asset: {
        assetType: "document",
        assetName: "My Doc",
        description: "",
        website: "",
        validUntil: "",
        email: "",
        password: "",
        customFields: {},
      },
      beneficiary: {
        fullName: "Ana",
        email: "",
        relationshipId: 1,
        phoneNumber: "",
        notes: "",
      },
      fileUrls: [],
      fileMetadata: [],
      locale: "es",
      idempotencyKey: "fixed-idempotency-key",
    };

    beforeEach(() => {
      jest.useFakeTimers();
      originalFetch = global.fetch;
      fetchMock = jest.fn();
      global.fetch = fetchMock as unknown as typeof fetch;
    });

    afterEach(() => {
      jest.useRealTimers();
      global.fetch = originalFetch;
    });

    it("retries once after 1 second on IDEMPOTENCY_IN_PROGRESS", async () => {
      fetchMock
        .mockResolvedValueOnce(
          makeMockResponse(409, { error: "IDEMPOTENCY_IN_PROGRESS", retryable: true }),
        )
        .mockResolvedValueOnce(makeMockResponse(201, { ok: true }));

      const promise = submitWizardCompleteWithRetry(payload);

      await jest.advanceTimersByTimeAsync(1000);
      const response = await promise;

      expect(response.status).toBe(201);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        "/api/wizard/complete",
        expect.objectContaining({
          headers: expect.objectContaining({ "Idempotency-Key": "fixed-idempotency-key" }),
        }),
      );
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        "/api/wizard/complete",
        expect.objectContaining({
          headers: expect.objectContaining({ "Idempotency-Key": "fixed-idempotency-key" }),
        }),
      );
    });

    it("does not retry when 409 is not retryable idempotency", async () => {
      fetchMock.mockResolvedValueOnce(makeMockResponse(409, { error: "LIMIT_REACHED", retryable: false }));

      const response = await submitWizardCompleteWithRetry(payload);

      expect(response.status).toBe(409);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("completion idempotency attempt key", () => {
    it("reuses the same key for retries of the same completion fingerprint", () => {
      const attemptA = resolveWizardCompletionAttemptKey({
        currentKey: null,
        currentFingerprint: null,
        nextFingerprint: "fingerprint-1",
        createKey: () => "first-key",
      });

      const attemptB = resolveWizardCompletionAttemptKey({
        currentKey: attemptA.key,
        currentFingerprint: attemptA.fingerprint,
        nextFingerprint: "fingerprint-1",
        createKey: () => "second-key",
      });

      expect(attemptA.key).toBe("first-key");
      expect(attemptB.key).toBe("first-key");
      expect(attemptB.reused).toBe(true);
    });

    it("mints a new key when submission identity changes", () => {
      const attempt = resolveWizardCompletionAttemptKey({
        currentKey: "first-key",
        currentFingerprint: "fingerprint-1",
        nextFingerprint: "fingerprint-2",
        createKey: () => "second-key",
      });

      expect(attempt.key).toBe("second-key");
      expect(attempt.reused).toBe(false);
    });

    it("builds a stable fingerprint regardless of custom field or file order", () => {
      const first = buildWizardCompletionFingerprint({
        asset: {
          ...baseAssetData,
          assetType: "document",
          assetName: "Doc",
          customFields: {
            b: "2",
            a: "1",
          },
        },
        beneficiary: {
          ...baseBeneficiary,
          fullName: "Ana",
          relationshipId: 4,
        },
        files: [
          { id: "file-b", file: {} as File, status: "uploaded", uploaded: { path: "/b", fileName: "b", fileType: "text/plain", fileSize: 1 } },
          { id: "file-a", file: {} as File, status: "uploaded", uploaded: { path: "/a", fileName: "a", fileType: "text/plain", fileSize: 1 } },
        ],
      });

      const second = buildWizardCompletionFingerprint({
        asset: {
          ...baseAssetData,
          assetType: "document",
          assetName: "Doc",
          customFields: {
            a: "1",
            b: "2",
          },
        },
        beneficiary: {
          ...baseBeneficiary,
          fullName: "Ana",
          relationshipId: 4,
        },
        files: [
          { id: "file-a", file: {} as File, status: "uploaded", uploaded: { path: "/a", fileName: "a", fileType: "text/plain", fileSize: 1 } },
          { id: "file-b", file: {} as File, status: "uploaded", uploaded: { path: "/b", fileName: "b", fileType: "text/plain", fileSize: 1 } },
        ],
      });

      expect(first).toBe(second);
    });

    it("keeps the same fingerprint before and after uploaded.path is set", () => {
      const file = { name: "doc.pdf", size: 1024 } as File;
      const basePayload = {
        asset: {
          ...baseAssetData,
          assetType: "document",
          assetName: "Doc",
        },
        beneficiary: {
          ...baseBeneficiary,
          fullName: "Ana",
          relationshipId: 4,
        },
      };

      const beforeUpload = buildWizardCompletionFingerprint({
        ...basePayload,
        files: [{ id: "file-1", file, status: "pending" }],
      });

      const afterUpload = buildWizardCompletionFingerprint({
        ...basePayload,
        files: [
          {
            id: "file-1",
            file,
            status: "uploaded",
            uploaded: { path: "/uploads/file-1", fileName: "doc.pdf", fileType: "application/pdf", fileSize: 1024 },
          },
        ],
      });

      expect(beforeUpload).toBe(afterUpload);
    });
  });
});
