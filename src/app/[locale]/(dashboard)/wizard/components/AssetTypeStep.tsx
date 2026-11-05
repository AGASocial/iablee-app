import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AssetType } from "@/lib/assetTypes";
import { getAssetIcon } from "../utils";

interface AssetTypeStepProps {
  assetTypes: AssetType[];
  selectedAssetType: string;
  loading: boolean;
  isError: boolean;
  errorMessage: string | null;
  onRetry: () => void;
  onSelect: (key: string) => void;
  onBack: () => void;
  onNext: () => void;
  fieldError?: string;
  onValidateBlur?: () => void;
  translate: (key: string, values?: Record<string, string | number>) => string;
}

export function AssetTypeStep({
  assetTypes,
  selectedAssetType,
  loading,
  isError,
  errorMessage,
  onRetry,
  onSelect,
  onBack,
  onNext,
  fieldError,
  onValidateBlur,
  translate,
}: AssetTypeStepProps) {
  return (
    <section className="space-y-5" onBlurCapture={onValidateBlur}>
      <div>
        <h2 className="font-heading text-2xl text-foreground">{translate("wizard-step-asset-type-title")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{translate("wizard-step-asset-type-description")}</p>
      </div>

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-24 animate-pulse rounded-xl border border-border bg-card" />
          ))}
        </div>
      ) : null}

      {!loading && isError ? (
        <div className="rounded-xl border border-warning bg-warning/15 p-4 text-foreground">
          <div className="mb-3 flex items-center gap-2 text-sm">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            <span>{errorMessage || translate("wizard-asset-types-error")}</span>
          </div>
          <Button type="button" variant="outline" onClick={onRetry} className="h-10">
            <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
            {translate("wizard-retry")}
          </Button>
        </div>
      ) : null}

      {!loading && !isError && assetTypes.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">{translate("wizard-asset-types-empty")}</p>
          <Button type="button" variant="outline" onClick={onRetry} className="mt-3 h-10">
            {translate("wizard-retry")}
          </Button>
        </div>
      ) : null}

      {!loading && !isError && assetTypes.length > 0 ? (
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium text-foreground">{translate("wizard-select-asset-type")}</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {assetTypes.map((assetType) => {
              const Icon = getAssetIcon(assetType.icon);
              const selected = selectedAssetType === assetType.key;
              return (
                <button
                  key={assetType.key}
                  type="button"
                  onClick={() => onSelect(assetType.key)}
                  data-asset-type-option="true"
                  className={cn(
                    "rounded-xl border p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    selected ? "border-primary bg-brand-tint" : "border-border bg-card hover:border-primary/40",
                  )}
                  aria-pressed={selected}
                >
                  <Icon className="mb-2 h-5 w-5 text-primary" aria-hidden="true" />
                  <p className="text-sm font-medium text-foreground">{translate(assetType.label)}</p>
                  {assetType.description ? (
                    <p className="mt-1 text-xs text-muted-foreground">{translate(assetType.description)}</p>
                  ) : null}
                </button>
              );
            })}
          </div>
          {fieldError ? <p className="text-sm text-destructive">{translate(fieldError)}</p> : null}
        </fieldset>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="button" variant="outline" className="h-11 flex-1" onClick={onBack}>
          {translate("back")}
        </Button>
        <Button type="button" className="h-11 flex-1" onClick={onNext}>
          {translate("wizard-next")}
        </Button>
      </div>
    </section>
  );
}
