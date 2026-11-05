import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SuccessStepProps {
  assetTypeLabel: string;
  assetName: string;
  beneficiaryName: string;
  onGoDashboard: () => void;
  onAddAnother: () => void;
  translate: (key: string, values?: Record<string, string | number>) => string;
}

export function SuccessStep({
  assetTypeLabel,
  assetName,
  beneficiaryName,
  onGoDashboard,
  onAddAnother,
  translate,
}: SuccessStepProps) {
  return (
    <section className="space-y-5">
      <div className="rounded-2xl border border-success bg-success/10 p-5">
        <CheckCircle2 className="mb-3 h-8 w-8 text-success" aria-hidden="true" />
        <h2 className="font-heading text-2xl text-foreground">{translate("wizard-success-title")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{translate("wizard-success-message")}</p>
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <h3 className="mb-2 text-sm font-semibold text-foreground">{translate("wizard-asset-summary")}</h3>
        <p className="text-sm text-foreground">
          {translate("assetType")}: <span className="text-muted-foreground">{assetTypeLabel}</span>
        </p>
        <p className="text-sm text-foreground">
          {translate("assetName")}: <span className="text-muted-foreground">{assetName}</span>
        </p>
        <p className="text-sm text-foreground">
          {translate("assignedBeneficiary")}: <span className="text-muted-foreground">{beneficiaryName}</span>
        </p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="button" className="h-11 flex-1" onClick={onGoDashboard}>
          {translate("wizard-go-dashboard")}
        </Button>
        <Button type="button" variant="outline" className="h-11 flex-1" onClick={onAddAnother}>
          {translate("wizard-add-another-asset")}
        </Button>
      </div>
    </section>
  );
}
