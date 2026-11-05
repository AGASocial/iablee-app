"use client";

import { CheckCircle2, Circle } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";

interface DashboardOnboardingChecklistProps {
  hasPin: boolean;
  totalAssets: number;
  totalBeneficiaries: number;
}

type ChecklistStep = {
  key: "pin" | "asset" | "beneficiary";
  href: "/settings/security" | "/wizard" | "/beneficiaries";
  done: boolean;
};

export default function DashboardOnboardingChecklist({
  hasPin,
  totalAssets,
  totalBeneficiaries,
}: DashboardOnboardingChecklistProps) {
  const t = useTranslations();
  const steps: ChecklistStep[] = [
    { key: "pin", href: "/settings/security", done: hasPin },
    { key: "asset", href: "/wizard", done: totalAssets > 0 },
    { key: "beneficiary", href: "/beneficiaries", done: totalBeneficiaries > 0 },
  ];

  const completedSteps = steps.filter((step) => step.done).length;
  const totalSteps = steps.length;
  const progress = Math.round((completedSteps / totalSteps) * 100);
  const nextStep = steps.find((step) => !step.done);

  const nextStepLabelByKey: Record<ChecklistStep["key"], string> = {
    pin: t("dashboardChecklistActionCreatePin"),
    asset: t("dashboardChecklistActionCreateAsset"),
    beneficiary: t("dashboardChecklistActionCreateBeneficiary"),
  };

  return (
    <section
      className="rounded-3xl border border-brand-chip/80 bg-brand-tint/70 p-6 shadow-sm backdrop-blur dark:border-border dark:bg-card/80"
      aria-labelledby="dashboard-checklist-title"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 id="dashboard-checklist-title" className="text-xl font-semibold text-brand-navy dark:text-foreground">
            {t("dashboardChecklistTitle")}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">{t("dashboardChecklistDescription")}</p>
        </div>
        <p className="rounded-full bg-card px-3 py-1 text-sm font-medium text-brand-navy dark:bg-secondary dark:text-foreground">
          {t("dashboardChecklistProgress", { completed: completedSteps, total: totalSteps })}
        </p>
      </div>

      <div className="mt-5">
        <div
          className="h-2 w-full overflow-hidden rounded-full bg-brand-chip dark:bg-secondary"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
          aria-valuetext={t("dashboardChecklistProgressAria", { progress })}
        >
          <div
            className="h-full rounded-full bg-primary transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <ol className="mt-6 space-y-3" aria-label={t("dashboardChecklistStepsAriaLabel")}>
        {steps.map((step) => {
          const titleByKey: Record<ChecklistStep["key"], string> = {
            pin: t("dashboardChecklistStepCreatePinTitle"),
            asset: t("dashboardChecklistStepAddAssetTitle"),
            beneficiary: t("dashboardChecklistStepAddBeneficiaryTitle"),
          };

          const statusLabel = step.done ? t("dashboardChecklistStatusDone") : t("dashboardChecklistStatusPending");

          return (
            <li
              key={step.key}
              className="flex items-center justify-between gap-3 rounded-2xl border border-border/70 bg-card/80 px-4 py-3 dark:bg-background/40"
            >
              <div className="flex items-center gap-3">
                {step.done ? (
                  <CheckCircle2 className="h-5 w-5 text-success" aria-hidden="true" />
                ) : (
                  <Circle className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                )}
                <span className="text-sm font-medium text-foreground">{titleByKey[step.key]}</span>
              </div>
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                  step.done ? "bg-success/10 text-success" : "bg-brand-chip text-brand-navy dark:bg-secondary dark:text-foreground"
                }`}
              >
                {statusLabel}
              </span>
            </li>
          );
        })}
      </ol>

      {nextStep ? (
        <div className="mt-6">
          <Button
            asChild
            className="w-full sm:w-auto focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <Link href={nextStep.href}>
              {nextStepLabelByKey[nextStep.key]}
            </Link>
          </Button>
        </div>
      ) : null}
    </section>
  );
}
