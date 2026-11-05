import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { AssetType } from "@/lib/assetTypes";
import { FileDropZone } from "./FileDropZone";
import type { AssetFormData, FieldErrors, FileUploadItem } from "./types";
import { hasRequiredAdvancedFields } from "../utils";

interface AssetDetailsStepProps {
  data: AssetFormData;
  errors: FieldErrors;
  assetType: AssetType | null;
  files: FileUploadItem[];
  maxFiles: number;
  maxFileSizeMb: number;
  showAdvanced: boolean;
  onToggleAdvanced: () => void;
  onChange: <K extends keyof AssetFormData>(field: K, value: AssetFormData[K]) => void;
  onCustomFieldChange: (key: string, value: string) => void;
  onAddFiles: (files: FileList | null) => void;
  onRemoveFile: (id: string) => void;
  onBack: () => void;
  onNext: () => void;
  canContinue: boolean;
  translate: (key: string, values?: Record<string, string | number>) => string;
}

export function AssetDetailsStep({
  data,
  errors,
  assetType,
  files,
  maxFiles,
  maxFileSizeMb,
  showAdvanced,
  onToggleAdvanced,
  onChange,
  onCustomFieldChange,
  onAddFiles,
  onRemoveFile,
  onBack,
  onNext,
  canContinue,
  translate,
}: AssetDetailsStepProps) {
  const requiredAdvanced = hasRequiredAdvancedFields(assetType);

  return (
    <section className="space-y-5">
      <div>
        <h2 className="font-heading text-2xl text-foreground">{translate("wizard-step-asset-details-title")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{translate("wizard-step-asset-details-description")}</p>
      </div>

      <div className="space-y-4">
        <div>
          <Label htmlFor="asset-name" className="text-sm text-foreground">
            {translate("assetName")} *
          </Label>
          <Input
            id="asset-name"
            value={data.assetName}
            onChange={(event) => onChange("assetName", event.target.value)}
            placeholder={translate("wizard-enter-asset-name")}
            aria-invalid={Boolean(errors.assetName)}
            aria-describedby={errors.assetName ? "asset-name-error" : undefined}
          />
          {errors.assetName ? (
            <p id="asset-name-error" className="mt-1 text-sm text-destructive">
              {translate(errors.assetName)}
            </p>
          ) : null}
        </div>

        <div>
          <Label htmlFor="asset-description" className="text-sm text-foreground">
            {translate("description")}
          </Label>
          <Textarea
            id="asset-description"
            value={data.description}
            onChange={(event) => onChange("description", event.target.value)}
            placeholder={translate("wizard-describe-asset")}
            aria-invalid={Boolean(errors.description)}
            aria-describedby={errors.description ? "asset-description-error" : undefined}
          />
          {errors.description ? (
            <p id="asset-description-error" className="mt-1 text-sm text-destructive">
              {translate(errors.description)}
            </p>
          ) : null}
        </div>
      </div>

      <Button type="button" variant="outline" onClick={onToggleAdvanced} className="h-11 w-full justify-between">
        {translate("wizard-more-options")}
        {showAdvanced ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </Button>

      {!showAdvanced && requiredAdvanced ? (
        <p className="text-sm text-muted-foreground">{translate("wizard-advanced-required-hint")}</p>
      ) : null}

      {showAdvanced ? (
        <div className="space-y-4 rounded-xl border border-border bg-card p-4">
          <div>
            <Label htmlFor="asset-website" className="text-sm text-foreground">
              {translate("website")}
            </Label>
            <Input
              id="asset-website"
              value={data.website}
              onChange={(event) => onChange("website", event.target.value)}
              placeholder={translate("wizard-enter-website")}
              aria-invalid={Boolean(errors.website)}
              aria-describedby={errors.website ? "asset-website-error" : undefined}
            />
            {errors.website ? (
              <p id="asset-website-error" className="mt-1 text-sm text-destructive">
                {translate(errors.website)}
              </p>
            ) : null}
          </div>

          <div>
            <Label htmlFor="asset-valid-until" className="text-sm text-foreground">
              {translate("validUntil")}
            </Label>
            <Input
              id="asset-valid-until"
              type="date"
              value={data.validUntil}
              onChange={(event) => onChange("validUntil", event.target.value)}
              aria-invalid={Boolean(errors.validUntil)}
              aria-describedby={errors.validUntil ? "asset-valid-until-error" : undefined}
            />
            {errors.validUntil ? (
              <p id="asset-valid-until-error" className="mt-1 text-sm text-destructive">
                {translate(errors.validUntil)}
              </p>
            ) : null}
          </div>

          <div>
            <Label htmlFor="asset-email" className="text-sm text-foreground">
              {translate("email")}
            </Label>
            <Input
              id="asset-email"
              value={data.email}
              onChange={(event) => onChange("email", event.target.value)}
              type="email"
              placeholder={translate("wizard-email-placeholder")}
              aria-invalid={Boolean(errors.email)}
              aria-describedby={errors.email ? "asset-email-error" : undefined}
            />
            {errors.email ? (
              <p id="asset-email-error" className="mt-1 text-sm text-destructive">
                {translate(errors.email)}
              </p>
            ) : null}
          </div>

          <div>
            <Label htmlFor="asset-password" className="text-sm text-foreground">
              {translate("password")}
            </Label>
            <Input
              id="asset-password"
              value={data.password}
              onChange={(event) => onChange("password", event.target.value)}
              type="password"
              placeholder={translate("wizard-password-placeholder")}
              aria-invalid={Boolean(errors.password)}
              aria-describedby={errors.password ? "asset-password-error" : undefined}
            />
            {errors.password ? (
              <p id="asset-password-error" className="mt-1 text-sm text-destructive">
                {translate(errors.password)}
              </p>
            ) : null}
          </div>

          {assetType?.customFields.map((field) => {
            const fieldId = `custom-${field.key}`;
            const errorKey = `custom:${field.key}`;
            const error = errors[errorKey];
            return (
              <div key={field.key}>
                <Label htmlFor={fieldId} className="text-sm text-foreground">
                  {translate(field.label)}
                  {field.required ? " *" : ""}
                </Label>
                {field.type === "textarea" ? (
                  <Textarea
                    id={fieldId}
                    value={data.customFields[field.key] || ""}
                    onChange={(event) => onCustomFieldChange(field.key, event.target.value)}
                    aria-invalid={Boolean(error)}
                    aria-describedby={error ? `${fieldId}-error` : undefined}
                  />
                ) : null}
                {field.type === "select" ? (
                  <Select
                    value={data.customFields[field.key] || undefined}
                    onValueChange={(value) => onCustomFieldChange(field.key, value)}
                  >
                    <SelectTrigger id={fieldId} aria-invalid={Boolean(error)} aria-describedby={error ? `${fieldId}-error` : undefined}>
                      <SelectValue placeholder={translate("wizard-select-placeholder")} />
                    </SelectTrigger>
                    <SelectContent>
                      {(field.options || []).map((option) => (
                        <SelectItem key={option} value={option}>
                          {translate(option)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : null}
                {(field.type === "text" || field.type === "file") ? (
                  <Input
                    id={fieldId}
                    type="text"
                    value={data.customFields[field.key] || ""}
                    onChange={(event) => onCustomFieldChange(field.key, event.target.value)}
                    aria-invalid={Boolean(error)}
                    aria-describedby={error ? `${fieldId}-error` : undefined}
                  />
                ) : null}
                {error ? (
                  <p id={`${fieldId}-error`} className="mt-1 text-sm text-destructive">
                    {translate(error)}
                  </p>
                ) : null}
              </div>
            );
          })}

          {assetType?.fileAccept ? (
            <div>
              <Label className="text-sm text-foreground">{translate("assetAttachments")}</Label>
              <FileDropZone
                files={files}
                maxFiles={maxFiles}
                maxFileSizeMb={maxFileSizeMb}
                accept={assetType.fileAccept}
                onAddFiles={onAddFiles}
                onRemoveFile={onRemoveFile}
                translate={translate}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="button" variant="outline" className="h-11 flex-1" onClick={onBack}>
          {translate("back")}
        </Button>
        <Button type="button" className="h-11 flex-1" onClick={onNext} disabled={!canContinue}>
          {translate("wizard-next")}
        </Button>
      </div>
    </section>
  );
}
