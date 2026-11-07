"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import SecurityPinModal from "@/components/security/SecurityPinModal";
import { useSecurity } from "@/context/SecurityContext";
import { useAuth } from "@/lib/auth";
import { useAssetTypes } from "@/lib/assetTypes";
import { useBilling } from "@/hooks/useDataQueries";
import { uploadWithConcurrency } from "@/lib/upload-concurrency";
import { wizardApiErrorMessage } from "./completion-error";
import { AssetDetailsStep } from "./components/AssetDetailsStep";
import { AssetTypeStep } from "./components/AssetTypeStep";
import { BeneficiaryStep } from "./components/BeneficiaryStep";
import { StepIndicator } from "./components/StepIndicator";
import { SuccessStep } from "./components/SuccessStep";
import { WelcomeStep } from "./components/WelcomeStep";
import type { AssetFormData, BeneficiaryFormData, FieldErrors, FileUploadItem, UploadStatus, UploadedFileMeta, WizardStep } from "./components/types";
import {
  MAX_WIZARD_FILES,
  buildWizardDraft,
  buildWizardCompletionFingerprint,
  formatBytesToMb,
  getWizardDraftStorageKey,
  parseWizardDraft,
  resolveWizardCompletionAttemptKey,
  sanitizeDraftCustomFields,
  submitWizardCompleteWithRetry,
  validateAssetDetails,
  validateAssetType,
  validateBeneficiary,
  type WizardDraftPayload,
} from "./utils";

type WizardView = "welcome" | "form" | "success";

type SecuritySessionResponse = {
  authenticated: boolean;
  hasPin: boolean;
  locked: boolean;
};

type LimitCheckResponse = {
  allowed: boolean;
  reason?: string;
  limit?: number;
  current?: number;
};

export default function WizardPage() {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const { user } = useAuth();
  const security = useSecurity();
  const tr = (key: string, values?: Record<string, string | number>) => {
    try {
      return values ? t(key as never, values as never) : t(key as never);
    } catch {
      return key;
    }
  };

  const { data: assetTypes = [], isLoading: assetTypesLoading, isError: assetTypesError, error: assetTypesErrorObj, refetch: refetchAssetTypes } = useAssetTypes();
  const { data: billingData } = useBilling();
  const maxFileSizeMb = billingData?.limits.maxFileSizeMb ?? 10;

  const [wizardView, setWizardView] = useState<WizardView>("welcome");
  const [step, setStep] = useState<WizardStep>("asset-type");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [relationships, setRelationships] = useState<Array<{ id: number; key: string }>>([]);
  const [files, setFiles] = useState<FileUploadItem[]>([]);
  const [pinOpen, setPinOpen] = useState(false);
  const [pinMode, setPinMode] = useState<"setup" | "verify">("verify");
  const [pinReason, setPinReason] = useState<string | null>(null);
  const [retryAfterPin, setRetryAfterPin] = useState(false);
  const [hasHydratedDraft, setHasHydratedDraft] = useState(false);
  const [draftPrompt, setDraftPrompt] = useState<WizardDraftPayload | null>(null);
  const [showErrors, setShowErrors] = useState({
    assetType: false,
    assetDetails: false,
    beneficiary: false,
  });

  const [assetData, setAssetData] = useState<AssetFormData>({
    assetType: "",
    assetName: "",
    description: "",
    website: "",
    validUntil: "",
    email: "",
    password: "",
    customFields: {},
  });
  const [beneficiaryData, setBeneficiaryData] = useState<BeneficiaryFormData>({
    fullName: "",
    email: "",
    relationshipId: null,
    phoneNumber: "",
    notes: "",
  });

  const currentAssetType = useMemo(
    () => assetTypes.find((assetType) => assetType.key === assetData.assetType) ?? null,
    [assetTypes, assetData.assetType],
  );
  const draftStorageKey = user?.id ? getWizardDraftStorageKey(user.id) : null;
  const completionAttemptRef = useRef<{ key: string; fingerprint: string } | null>(null);

  const assetTypeErrors = validateAssetType(assetData);
  const assetDetailErrors = validateAssetDetails(assetData, currentAssetType, files);
  const beneficiaryErrors = validateBeneficiary(beneficiaryData);

  const canContinueAssetType = Object.keys(assetTypeErrors).length === 0;
  const canContinueAssetDetails = Object.keys(assetDetailErrors).length === 0;
  const canSave = Object.keys(beneficiaryErrors).length === 0;

  const markStepTouched = (target: keyof typeof showErrors) => {
    setShowErrors((prev) => (prev[target] ? prev : { ...prev, [target]: true }));
  };

  const focusElementById = (id: string): boolean => {
    const element = document.getElementById(id);
    if (!element) return false;
    element.focus();
    return true;
  };

  const focusFirstAssetTypeError = () => {
    const firstOption = document.querySelector<HTMLElement>('[data-asset-type-option="true"]');
    firstOption?.focus();
  };

  const focusFirstAssetDetailsError = (errors: FieldErrors) => {
    if (errors.assetName && focusElementById("asset-name")) return;
    if (errors.description && focusElementById("asset-description")) return;

    const advancedFieldOrder: Array<[keyof FieldErrors, string]> = [
      ["website", "asset-website"],
      ["validUntil", "asset-valid-until"],
      ["email", "asset-email"],
      ["password", "asset-password"],
    ];
    const firstAdvanced = advancedFieldOrder.find(([key]) => Boolean(errors[key]));
    if (firstAdvanced) {
      setShowAdvanced(true);
      requestAnimationFrame(() => {
        focusElementById(firstAdvanced[1]);
      });
      return;
    }

    const firstCustom = Object.keys(errors).find((key) => key.startsWith("custom:"));
    if (!firstCustom) return;
    setShowAdvanced(true);
    requestAnimationFrame(() => {
      const customId = `custom-${firstCustom.replace("custom:", "")}`;
      if (focusElementById(customId)) return;
      const dropzone = document.querySelector<HTMLElement>('[data-file-dropzone="true"]');
      dropzone?.focus();
    });
  };

  const focusFirstBeneficiaryError = (errors: FieldErrors) => {
    if (errors.fullName && focusElementById("beneficiary-name")) return;
    if (errors.email && focusElementById("beneficiary-email")) return;
    if (errors.relationshipId) {
      focusElementById("beneficiary-relationship");
    }
  };

  useEffect(() => {
    fetch("/api/relationships?minGenerationLevel=3")
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setRelationships(data))
      .catch((error) => console.error("Error fetching relationships:", error));
  }, []);

  useEffect(() => {
    if (!assetTypesError || !assetTypesErrorObj) return;
    console.error("Failed to load asset types in wizard:", assetTypesErrorObj);
  }, [assetTypesError, assetTypesErrorObj]);

  const updateFileStatus = (fileId: string, status: UploadStatus, error?: string, uploaded?: FileUploadItem["uploaded"]) => {
    setFiles((prev) =>
      prev.map((item) => {
        if (item.id !== fileId) return item;
        return { ...item, status, error, uploaded };
      }),
    );
  };

  const handleAddFiles = (fileList: FileList | null) => {
    if (!fileList) return;
    const incoming = Array.from(fileList);
    const availableSlots = Math.max(MAX_WIZARD_FILES - files.length, 0);
    const selected = incoming.slice(0, availableSlots);

    if (incoming.length > availableSlots) {
      toast.error(tr("wizard-file-max-count-error", { count: MAX_WIZARD_FILES }));
    }

    const overSize = selected.filter((file) => file.size > maxFileSizeMb * 1024 * 1024);
    if (overSize.length > 0) {
      toast.error(
        tr("wizard-file-max-size-error", {
          size: maxFileSizeMb,
          file: `${overSize[0].name} (${formatBytesToMb(overSize[0].size)} MB)`,
        }),
      );
    }

    const validFiles = selected.filter((file) => file.size <= maxFileSizeMb * 1024 * 1024);
    if (validFiles.length === 0) return;

    const existingIds = new Set(files.map((file) => file.id));
    const newItems: FileUploadItem[] = validFiles
      .map((file) => ({
        id: `${file.name}-${file.size}-${file.lastModified}`,
        file,
        status: "pending" as const,
      }))
      .filter((item) => !existingIds.has(item.id));

    setFiles((prev) => [...prev, ...newItems]);
  };

  const handleRemoveFile = (id: string) => {
    setFiles((prev) => prev.filter((item) => item.id !== id));
  };

  const checkSecuritySession = async () => {
    const res = await fetch("/api/security/check-session");
    if (!res.ok) {
      throw new Error("failedToCheckSecuritySession");
    }
    const data = (await res.json()) as SecuritySessionResponse;
    if (!data.hasPin) {
      const pinMessage = tr("wizard-pin-setup-message");
      setPinMode("setup");
      setPinReason(pinMessage);
      setRetryAfterPin(true);
      setPinOpen(true);
      toast.error(pinMessage);
      return false;
    }
    if (data.locked) {
      const pinMessage = tr("wizard-pin-protect-message");
      setPinMode("verify");
      setPinReason(pinMessage);
      setRetryAfterPin(true);
      setPinOpen(true);
      toast.error(pinMessage);
      return false;
    }
    return true;
  };

  const checkSubscriptionLimits = async () => {
    const [assetRes, beneficiaryRes] = await Promise.all([
      fetch("/api/subscription/check-limit?type=asset"),
      fetch("/api/subscription/check-limit?type=beneficiary"),
    ]);

    if (!assetRes.ok || !beneficiaryRes.ok) {
      throw new Error("errorSavingAsset");
    }

    const assetLimit = (await assetRes.json()) as LimitCheckResponse;
    const beneficiaryLimit = (await beneficiaryRes.json()) as LimitCheckResponse;

    if (!assetLimit.allowed) {
      throw new Error("assetLimitReached");
    }
    if (!beneficiaryLimit.allowed) {
      throw new Error("beneficiaryLimitReached");
    }
  };

  const openPinModalForSecurity = () => {
    const needsSetup = !security.hasPin;
    const friendlyPinMessage = needsSetup ? tr("wizard-pin-setup-message") : tr("wizard-pin-protect-message");
    setPinMode(needsSetup ? "setup" : "verify");
    setPinReason(friendlyPinMessage);
    setRetryAfterPin(true);
    setPinOpen(true);
    toast.error(friendlyPinMessage);
  };

  const uploadPendingFiles = async (): Promise<UploadedFileMeta[]> => {
    const pendingItems = files.filter((item) => !item.uploaded);
    const alreadyUploaded = files.filter((item) => item.uploaded).map((item) => item.uploaded as UploadedFileMeta);
    if (pendingItems.length === 0) return alreadyUploaded;

    pendingItems.forEach((item) => updateFileStatus(item.id, "uploading"));

    const uploadResults = await uploadWithConcurrency(
      pendingItems.map((item) => item.file),
      async (file) => {
        const formData = new FormData();
        formData.append("file", file);
        const uploadRes = await fetch("/api/storage/upload", {
          method: "POST",
          body: formData,
        });
        if (!uploadRes.ok) {
          const errBody = await uploadRes.json().catch(() => null);
          const errMessage =
            errBody && typeof errBody === "object" && "error" in errBody
              ? String(errBody.error)
              : tr("errorUploadingFiles");
          if (uploadRes.status === 403 && errMessage === "Security PIN required") {
            throw new Error("wizard-pin-required");
          }
          throw new Error(errMessage);
        }
        return (await uploadRes.json()) as {
          path: string;
          fileName: string;
          fileType: string;
          fileSize: number;
        };
      },
      3,
    );

    let uploadFailed = false;
    let pinRequiredDuringUpload = false;
    const newlyUploaded: UploadedFileMeta[] = [];
    uploadResults.forEach((result) => {
      const item = pendingItems.find((candidate) => candidate.file === result.file);
      if (!item) return;
      if (result.ok && result.data) {
        const uploadedFile = {
          path: result.data.path,
          fileName: result.data.fileName,
          fileType: result.data.fileType,
          fileSize: result.data.fileSize,
        };
        newlyUploaded.push(uploadedFile);
        updateFileStatus(item.id, "uploaded", undefined, {
          path: uploadedFile.path,
          fileName: uploadedFile.fileName,
          fileType: uploadedFile.fileType,
          fileSize: uploadedFile.fileSize,
        });
      } else {
        if (result.error === "wizard-pin-required") {
          pinRequiredDuringUpload = true;
        }
        uploadFailed = true;
        updateFileStatus(item.id, "error", result.error || tr("errorUploadingFiles"));
      }
    });

    if (pinRequiredDuringUpload) {
      throw new Error("wizard-pin-required");
    }

    if (uploadFailed) {
      throw new Error("wizard-upload-failed-retry");
    }

    return [...alreadyUploaded, ...newlyUploaded];
  };

  const handleSave = async () => {
    if (saving) return;
    markStepTouched("beneficiary");
    if (!canSave) {
      focusFirstBeneficiaryError(beneficiaryErrors);
      return;
    }

    setSaving(true);
    setSaveError(null);

    try {
      const sessionReady = await checkSecuritySession();
      if (!sessionReady) return;
      await checkSubscriptionLimits();
      const attemptFingerprint = buildWizardCompletionFingerprint({
        asset: assetData,
        beneficiary: beneficiaryData,
        files,
      });
      const attemptState = resolveWizardCompletionAttemptKey({
        currentKey: completionAttemptRef.current?.key ?? null,
        currentFingerprint: completionAttemptRef.current?.fingerprint ?? null,
        nextFingerprint: attemptFingerprint,
      });
      completionAttemptRef.current = {
        key: attemptState.key,
        fingerprint: attemptState.fingerprint,
      };

      const uploadedFiles = await uploadPendingFiles();
      const fileUrls = uploadedFiles.map((file) => file.path);
      const fileMetadata = uploadedFiles.map((file) => ({
        path: file.path,
        fileName: file.fileName,
        fileType: file.fileType,
        fileSize: file.fileSize,
      }));

      const res = await submitWizardCompleteWithRetry({
        asset: {
          assetType: assetData.assetType,
          assetName: assetData.assetName,
          description: assetData.description,
          website: assetData.website,
          validUntil: assetData.validUntil,
          email: assetData.email,
          password: assetData.password,
          customFields: assetData.customFields,
        },
        beneficiary: {
          fullName: beneficiaryData.fullName,
          email: beneficiaryData.email,
          relationshipId: beneficiaryData.relationshipId,
          phoneNumber: beneficiaryData.phoneNumber,
          notes: beneficiaryData.notes,
        },
        fileUrls,
        fileMetadata,
        locale,
        idempotencyKey: attemptState.key,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        const err = body && typeof body === "object" ? (body as { message?: string; error?: string }) : {};
        const pinMessage = wizardApiErrorMessage(res.status, err.error, t);
        if (pinMessage) {
          openPinModalForSecurity();
          return;
        }
        throw new Error(err.message || err.error || "errorSavingAsset");
      }

      setRetryAfterPin(false);
      if (draftStorageKey) {
        localStorage.removeItem(draftStorageKey);
      }
      completionAttemptRef.current = null;
      setDraftPrompt(null);
      setWizardView("success");
    } catch (error) {
      console.error("Error creating asset and beneficiary:", error);
      if (error instanceof Error && error.message === "wizard-pin-required") {
        openPinModalForSecurity();
        return;
      }
      const message = error instanceof Error ? error.message : "errorSavingAsset";
      setSaveError(message);
      toast.error(tr(message as string));
    } finally {
      setSaving(false);
    }
  };

  const resetWizard = () => {
    setWizardView("form");
    setStep("asset-type");
    setShowAdvanced(false);
    setSaveError(null);
    setShowErrors({
      assetType: false,
      assetDetails: false,
      beneficiary: false,
    });
    setFiles([]);
    completionAttemptRef.current = null;
    setAssetData({
      assetType: "",
      assetName: "",
      description: "",
      website: "",
      validUntil: "",
      email: "",
      password: "",
      customFields: {},
    });
    setBeneficiaryData({
      fullName: "",
      email: "",
      relationshipId: null,
      phoneNumber: "",
      notes: "",
    });
  };

  const startWizardFromScratch = () => {
    if (draftStorageKey) {
      localStorage.removeItem(draftStorageKey);
    }
    completionAttemptRef.current = null;
    setDraftPrompt(null);
    resetWizard();
    setWizardView("welcome");
  };

  const continueWithDraft = () => {
    if (!draftPrompt) return;
    const restoredAssetType = assetTypes.find((assetType) => assetType.key === draftPrompt.asset.assetType) ?? null;
    const sanitizedCustomFields = sanitizeDraftCustomFields(draftPrompt.asset.customFields, restoredAssetType);
    setAssetData((prev) => ({
      ...prev,
      assetType: draftPrompt.asset.assetType,
      assetName: draftPrompt.asset.assetName,
      description: draftPrompt.asset.description,
      website: draftPrompt.asset.website,
      validUntil: draftPrompt.asset.validUntil,
      email: draftPrompt.asset.email,
      password: "",
      customFields: sanitizedCustomFields,
    }));
    setBeneficiaryData(draftPrompt.beneficiary);
    setStep(draftPrompt.step);
    setWizardView("form");
    setDraftPrompt(null);
  };

  const onNextFromAssetType = () => {
    markStepTouched("assetType");
    if (!canContinueAssetType) {
      focusFirstAssetTypeError();
      return;
    }
    setStep("asset-details");
  };

  const onNextFromAssetDetails = () => {
    markStepTouched("assetDetails");
    if (!canContinueAssetDetails) {
      focusFirstAssetDetailsError(assetDetailErrors);
      return;
    }
    setStep("beneficiary");
  };

  useEffect(() => {
    if (!draftStorageKey || !user?.id || typeof window === "undefined") {
      queueMicrotask(() => setHasHydratedDraft(true));
      return;
    }

    const existingDraft = parseWizardDraft(localStorage.getItem(draftStorageKey), user.id, assetTypes);
    queueMicrotask(() => {
      setDraftPrompt(existingDraft);
      setHasHydratedDraft(true);
    });
  }, [draftStorageKey, user?.id, assetTypes]);

  useEffect(() => {
    if (!hasHydratedDraft || !draftStorageKey || !user?.id || wizardView !== "form") return;
    const handler = window.setTimeout(() => {
      const draft = buildWizardDraft({
        userId: user.id,
        step,
        assetData,
        beneficiaryData,
        assetType: currentAssetType,
      });
      localStorage.setItem(draftStorageKey, JSON.stringify(draft));
    }, 450);

    return () => window.clearTimeout(handler);
  }, [
    hasHydratedDraft,
    draftStorageKey,
    user?.id,
    wizardView,
    step,
    assetData,
    beneficiaryData,
    currentAssetType,
  ]);

  return (
    <ProtectedRoute>
      <div className="mx-auto w-full max-w-3xl rounded-2xl border border-border bg-card p-4 sm:p-6">
        {wizardView === "welcome" ? (
          <>
            {draftPrompt ? (
              <div className="mb-4 rounded-xl border border-primary/40 bg-primary/10 p-4">
                <p className="text-sm font-medium text-foreground">{tr("wizard-draft-continue-title")}</p>
                <p className="mt-1 text-sm text-muted-foreground">{tr("wizard-draft-continue-description")}</p>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
                    onClick={continueWithDraft}
                  >
                    {tr("wizard-draft-continue-button")}
                  </button>
                  <button
                    type="button"
                    className="inline-flex h-10 items-center justify-center rounded-md border border-border px-4 text-sm font-medium text-foreground"
                    onClick={startWizardFromScratch}
                  >
                    {tr("wizard-draft-restart-button")}
                  </button>
                </div>
              </div>
            ) : null}
            <WelcomeStep
              userName={user?.user_metadata?.full_name || user?.email || tr("wizard-user-fallback")}
              onStart={() => setWizardView("form")}
              translate={tr}
            />
          </>
        ) : null}

        {wizardView === "form" ? (
          <>
            {pinReason ? (
              <div className="mb-4 rounded-xl border border-warning bg-warning/15 p-3 text-sm text-foreground">
                {pinReason}
              </div>
            ) : null}
            <StepIndicator currentStep={step} translate={tr} />
            {step === "asset-type" ? (
              <AssetTypeStep
                assetTypes={assetTypes}
                selectedAssetType={assetData.assetType}
                loading={assetTypesLoading}
                isError={assetTypesError}
                errorMessage={tr("wizard-asset-types-error")}
                onRetry={() => void refetchAssetTypes()}
                onSelect={(value) => {
                  setAssetData((prev) => ({ ...prev, assetType: value }));
                  setShowErrors((prev) => ({ ...prev, assetType: false }));
                }}
                onBack={() => setWizardView("welcome")}
                onNext={onNextFromAssetType}
                onValidateBlur={() => markStepTouched("assetType")}
                fieldError={showErrors.assetType ? assetTypeErrors.assetType : undefined}
                translate={tr}
              />
            ) : null}

            {step === "asset-details" ? (
              <AssetDetailsStep
                data={assetData}
                errors={showErrors.assetDetails ? assetDetailErrors : {}}
                assetType={currentAssetType}
                files={files.map((file) => ({
                  ...file,
                  error: file.error ? tr(file.error) : undefined,
                }))}
                maxFiles={MAX_WIZARD_FILES}
                maxFileSizeMb={maxFileSizeMb}
                showAdvanced={showAdvanced}
                onToggleAdvanced={() => setShowAdvanced((prev) => !prev)}
                onChange={(field, value) => {
                  setAssetData((prev) => ({ ...prev, [field]: value }));
                  if (showErrors.assetDetails) {
                    setShowErrors((prev) => ({ ...prev, assetDetails: true }));
                  }
                }}
                onCustomFieldChange={(fieldKey, value) => {
                  setAssetData((prev) => ({
                    ...prev,
                    customFields: {
                      ...prev.customFields,
                      [fieldKey]: value,
                    },
                  }));
                }}
                onAddFiles={handleAddFiles}
                onRemoveFile={handleRemoveFile}
                onBack={() => setStep("asset-type")}
                onNext={onNextFromAssetDetails}
                onValidateBlur={() => markStepTouched("assetDetails")}
                translate={tr}
              />
            ) : null}

            {step === "beneficiary" ? (
              <BeneficiaryStep
                data={beneficiaryData}
                errors={showErrors.beneficiary ? beneficiaryErrors : {}}
                relationships={relationships}
                saving={saving}
                onChange={(field, value) => {
                  setBeneficiaryData((prev) => ({ ...prev, [field]: value }));
                }}
                onBack={() => setStep("asset-details")}
                onSave={() => void handleSave()}
                onValidateBlur={() => markStepTouched("beneficiary")}
                translate={tr}
              />
            ) : null}

            {saveError ? (
              <div className="mt-4 rounded-xl border border-destructive bg-destructive/10 p-3">
                <p className="text-sm text-destructive">{tr(saveError)}</p>
              </div>
            ) : null}
          </>
        ) : null}

        {wizardView === "success" ? (
          <SuccessStep
            assetTypeLabel={
              currentAssetType ? tr(currentAssetType.label) : assetData.assetType
            }
            assetName={assetData.assetName}
            beneficiaryName={beneficiaryData.fullName}
            onGoDashboard={() => router.push("/dashboard")}
            onAddAnother={resetWizard}
            translate={tr}
          />
        ) : null}
      </div>

      <SecurityPinModal
        isOpen={pinOpen}
        mode={pinMode}
        forceOpen={false}
        onSuccess={async () => {
          await security.checkStatus();
          setPinOpen(false);
          setPinReason(null);
          toast.success(tr("wizard-pin-confirmed"));
          if (retryAfterPin) {
            setRetryAfterPin(false);
            await handleSave();
          }
        }}
        onCancel={() => {
          setPinOpen(false);
          setRetryAfterPin(false);
          setPinReason(null);
        }}
      />

    </ProtectedRoute>
  );
}
