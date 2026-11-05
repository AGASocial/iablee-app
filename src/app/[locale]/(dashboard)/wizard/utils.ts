import {
  Camera,
  File,
  FileText,
  Globe,
  KeyRound,
  Lock,
  Mail,
  Mic,
  Video,
  type LucideIcon,
} from "lucide-react";
import type { AssetType } from "@/lib/assetTypes";
import type { AssetFormData, BeneficiaryFormData, FieldErrors, FileUploadItem, WizardStep } from "./components/types";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const MAX_WIZARD_FILES = 5;

const ASSET_ICON_MAP: Record<string, LucideIcon> = {
  Mail,
  Mic,
  Camera,
  Video,
  File,
  FileText,
  Globe,
  Lock,
  KeyRound,
};

const ADVANCED_FIELDS = new Set(["website", "valid_until", "email", "password"]);
const DRAFT_ALLOWED_CUSTOM_FIELD_TYPES = new Set(["text", "textarea", "date", "url", "number", "select"]);
const SENSITIVE_CUSTOM_FIELD_KEY_PATTERNS = /(password|secret|token|pin|key|apikey|private|seed|mnemonic|cvv|card)/i;
const WIZARD_DRAFT_VERSION = 1;

export interface WizardDraftPayload {
  version: number;
  userId: string;
  step: WizardStep;
  asset: {
    assetType: string;
    assetName: string;
    description: string;
    website: string;
    validUntil: string;
    email: string;
    customFields: Record<string, string>;
  };
  beneficiary: BeneficiaryFormData;
}

export function getAssetIcon(iconName: string | null | undefined): LucideIcon {
  if (!iconName) return File;
  return ASSET_ICON_MAP[iconName] ?? File;
}

export function isValidEmail(value: string): boolean {
  return EMAIL_REGEX.test(value.trim());
}

function requiredFieldValue(fieldName: string, assetData: AssetFormData): string {
  if (fieldName === "valid_until") return assetData.validUntil.trim();
  if (fieldName === "asset_name") return assetData.assetName.trim();
  if (fieldName === "description") return assetData.description.trim();
  if (fieldName === "website") return assetData.website.trim();
  if (fieldName === "email") return assetData.email.trim();
  if (fieldName === "password") return assetData.password.trim();
  return "";
}

export function hasRequiredAdvancedFields(assetType: AssetType | null): boolean {
  if (!assetType) return false;
  const hasRequiredCoreAdvanced = assetType.requiredFields.some((field) => ADVANCED_FIELDS.has(field));
  const hasRequiredCustom = assetType.customFields.some((field) => field.required);
  return hasRequiredCoreAdvanced || hasRequiredCustom;
}

export function validateAssetType(assetData: AssetFormData): FieldErrors {
  const errors: FieldErrors = {};
  if (!assetData.assetType.trim()) {
    errors.assetType = "wizard-validation-asset-type-required";
  }
  return errors;
}

export function validateAssetDetails(assetData: AssetFormData, assetType: AssetType | null, files: FileUploadItem[] = []): FieldErrors {
  const errors: FieldErrors = {};

  if (!assetData.assetName.trim()) {
    errors.assetName = "wizard-validation-required";
  }

  if (assetData.email.trim() && !isValidEmail(assetData.email)) {
    errors.email = "wizard-validation-email";
  }

  if (!assetType) {
    return errors;
  }

  for (const fieldName of assetType.requiredFields) {
    if (fieldName === "asset_name") continue;
    if (!requiredFieldValue(fieldName, assetData)) {
      if (fieldName === "valid_until") errors.validUntil = "wizard-validation-required";
      if (fieldName === "description") errors.description = "wizard-validation-required";
      if (fieldName === "website") errors.website = "wizard-validation-required";
      if (fieldName === "email") errors.email = "wizard-validation-required";
      if (fieldName === "password") errors.password = "wizard-validation-required";
    }
  }

  for (const customField of assetType.customFields) {
    if (!customField.required) continue;
    if (customField.type === "file") {
      if (files.length === 0) {
        errors[`custom:${customField.key}`] = "wizard-validation-required";
      }
      continue;
    }
    const value = assetData.customFields[customField.key];
    if (!String(value ?? "").trim()) {
      errors[`custom:${customField.key}`] = "wizard-validation-required";
    }
  }

  return errors;
}

export function validateBeneficiary(beneficiary: BeneficiaryFormData): FieldErrors {
  const errors: FieldErrors = {};

  if (!beneficiary.fullName.trim()) {
    errors.fullName = "wizard-validation-required";
  }

  if (!beneficiary.relationshipId) {
    errors.relationshipId = "wizard-validation-required";
  }

  if (beneficiary.email.trim() && !isValidEmail(beneficiary.email)) {
    errors.email = "wizard-validation-email";
  }

  return errors;
}

export function formatBytesToMb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

function isAllowedDraftCustomFieldType(type: string | undefined): boolean {
  if (!type) return false;
  return DRAFT_ALLOWED_CUSTOM_FIELD_TYPES.has(type.toLowerCase());
}

export function sanitizeDraftCustomFields(customFields: Record<string, string>, assetType: AssetType | null): Record<string, string> {
  const definitions = new Map(assetType?.customFields.map((field) => [field.key, field]) ?? []);
  const entries = Object.entries(customFields).filter(([key]) => {
    const definition = definitions.get(key);
    if (!definition) return false;
    if (definition.type === "password") return false;
    if (!isAllowedDraftCustomFieldType(definition.type)) return false;
    if (SENSITIVE_CUSTOM_FIELD_KEY_PATTERNS.test(key)) return false;
    return true;
  });
  return Object.fromEntries(entries);
}

type WizardCompleteRequestBody = {
  asset: {
    assetType: string;
    assetName: string;
    description: string;
    website: string;
    validUntil: string;
    email: string;
    password: string;
    customFields: Record<string, string>;
  };
  beneficiary: BeneficiaryFormData;
  fileUrls: string[];
  fileMetadata: Array<{
    path: string;
    fileName: string;
    fileType: string;
    fileSize: number;
  }>;
  locale: string;
  idempotencyKey: string;
};

const RETRYABLE_IDEMPOTENCY_ERROR = "IDEMPOTENCY_IN_PROGRESS";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function sendWizardCompleteRequest(payload: WizardCompleteRequestBody): Promise<Response> {
  return fetch("/api/wizard/complete", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": payload.idempotencyKey,
    },
    body: JSON.stringify(payload),
  });
}

export async function submitWizardCompleteWithRetry(payload: WizardCompleteRequestBody): Promise<Response> {
  const firstAttempt = await sendWizardCompleteRequest(payload);
  if (firstAttempt.status !== 409) return firstAttempt;

  const firstBody = await firstAttempt.clone().json().catch(() => null) as
    | { error?: string; retryable?: boolean }
    | null;
  const shouldRetry = firstBody?.error === RETRYABLE_IDEMPOTENCY_ERROR && firstBody.retryable === true;
  if (!shouldRetry) return firstAttempt;

  await sleep(1000);
  return sendWizardCompleteRequest(payload);
}

export function getWizardDraftStorageKey(userId: string): string {
  return `wizard:draft:${userId}`;
}

export function buildWizardDraft({
  userId,
  step,
  assetData,
  beneficiaryData,
  assetType,
}: {
  userId: string;
  step: WizardStep;
  assetData: AssetFormData;
  beneficiaryData: BeneficiaryFormData;
  assetType: AssetType | null;
}): WizardDraftPayload {
  return {
    version: WIZARD_DRAFT_VERSION,
    userId,
    step,
    asset: {
      assetType: assetData.assetType,
      assetName: assetData.assetName,
      description: assetData.description,
      website: assetData.website,
      validUntil: assetData.validUntil,
      email: assetData.email,
      customFields: sanitizeDraftCustomFields(assetData.customFields, assetType),
    },
    beneficiary: {
      fullName: beneficiaryData.fullName,
      email: beneficiaryData.email,
      relationshipId: beneficiaryData.relationshipId,
      phoneNumber: beneficiaryData.phoneNumber,
      notes: beneficiaryData.notes,
    },
  };
}

function normalizeDraftCustomFields(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  const entries = Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string");
  return Object.fromEntries(entries);
}

export function parseWizardDraft(raw: string | null, userId: string, assetTypes: AssetType[] = []): WizardDraftPayload | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<WizardDraftPayload>;
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.userId !== userId) return null;
    if (!parsed.asset || !parsed.beneficiary) return null;
    if (typeof parsed.asset.assetType !== "string") return null;
    if (typeof parsed.asset.assetName !== "string") return null;
    if (typeof parsed.asset.description !== "string") return null;
    if (typeof parsed.asset.website !== "string") return null;
    if (typeof parsed.asset.validUntil !== "string") return null;
    if (typeof parsed.asset.email !== "string") return null;
    if (!parsed.asset.customFields || typeof parsed.asset.customFields !== "object") return null;
    if (typeof parsed.beneficiary.fullName !== "string") return null;
    if (typeof parsed.beneficiary.email !== "string") return null;
    if (typeof parsed.beneficiary.phoneNumber !== "string") return null;
    if (typeof parsed.beneficiary.notes !== "string") return null;
    if (!["asset-type", "asset-details", "beneficiary"].includes(String(parsed.step))) return null;
    const parsedAssetType = assetTypes.find((assetType) => assetType.key === parsed.asset?.assetType) ?? null;
    const sanitizedCustomFields = sanitizeDraftCustomFields(
      normalizeDraftCustomFields(parsed.asset.customFields),
      parsedAssetType,
    );
    return {
      version: Number(parsed.version ?? WIZARD_DRAFT_VERSION),
      userId: parsed.userId,
      step: parsed.step as WizardStep,
      asset: {
        assetType: parsed.asset.assetType,
        assetName: parsed.asset.assetName,
        description: parsed.asset.description,
        website: parsed.asset.website,
        validUntil: parsed.asset.validUntil,
        email: parsed.asset.email,
        customFields: sanitizedCustomFields,
      },
      beneficiary: {
        fullName: parsed.beneficiary.fullName,
        email: parsed.beneficiary.email,
        relationshipId: parsed.beneficiary.relationshipId ?? null,
        phoneNumber: parsed.beneficiary.phoneNumber,
        notes: parsed.beneficiary.notes,
      },
    };
  } catch {
    return null;
  }
}
