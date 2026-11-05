import type { AssetType } from "@/lib/assetTypes";

export type WizardStep = "asset-type" | "asset-details" | "beneficiary";

export interface AssetFormData {
  assetType: string;
  assetName: string;
  description: string;
  website: string;
  validUntil: string;
  email: string;
  password: string;
  customFields: Record<string, string>;
}

export interface BeneficiaryFormData {
  fullName: string;
  email: string;
  relationshipId: number | null;
  phoneNumber: string;
  notes: string;
}

export type UploadStatus = "pending" | "uploading" | "uploaded" | "error";

export interface UploadedFileMeta {
  path: string;
  fileName: string;
  fileType: string;
  fileSize: number;
}

export interface FileUploadItem {
  id: string;
  file: File;
  status: UploadStatus;
  error?: string;
  uploaded?: UploadedFileMeta;
}

export type FieldErrors = Record<string, string>;

export interface WizardAssetType extends AssetType {
  iconComponent: string;
}
