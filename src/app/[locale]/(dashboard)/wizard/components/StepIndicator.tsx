import { cn } from "@/lib/utils";
import type { WizardStep } from "./types";

const STEP_ORDER: WizardStep[] = ["asset-type", "asset-details", "beneficiary"];

interface StepIndicatorProps {
  currentStep: WizardStep;
  translate: (key: string, values?: Record<string, string | number>) => string;
}

export function StepIndicator({ currentStep, translate }: StepIndicatorProps) {
  const currentIndex = STEP_ORDER.indexOf(currentStep);
  const currentNumber = currentIndex + 1;

  return (
    <div className="mb-6">
      <p className="mb-3 text-sm text-muted-foreground" aria-live="polite">
        {translate("wizard-step-x-of-3", { current: currentNumber, total: STEP_ORDER.length })}
      </p>
      <ol className="flex items-center gap-3" aria-label={translate("wizard-step-indicator-label")}>
        {STEP_ORDER.map((step, index) => {
          const isCurrent = step === currentStep;
          const isComplete = index < currentIndex;
          return (
            <li key={step} className="flex flex-1 items-center gap-3">
              <span
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-full border text-sm font-semibold",
                  isCurrent && "border-primary bg-primary text-primary-foreground",
                  !isCurrent && isComplete && "border-success bg-success text-success-foreground",
                  !isCurrent && !isComplete && "border-border bg-card text-muted-foreground",
                )}
                aria-current={isCurrent ? "step" : undefined}
              >
                {index + 1}
              </span>
              {index < STEP_ORDER.length - 1 ? (
                <span className={cn("h-1 flex-1 rounded bg-border", isComplete && "bg-success")} />
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
