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
import type { AssetFormData, BeneficiaryFormData, FieldErrors } from "./components/types";

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

export function validateAssetDetails(assetData: AssetFormData, assetType: AssetType | null): FieldErrors {
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
