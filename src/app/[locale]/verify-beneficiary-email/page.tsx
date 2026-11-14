"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { CheckCircle2, XCircle, Clock, type LucideIcon } from "lucide-react";
import Link from "next/link";

type VerificationStatus = "success" | "expired" | "used" | "invalid";

const STATUS_CONFIG: Record<
  VerificationStatus,
  { icon: LucideIcon; titleKey: string; descriptionKey: string; className: string }
> = {
  success: {
    icon: CheckCircle2,
    titleKey: "beneficiaryEmailVerifySuccessTitle",
    descriptionKey: "beneficiaryEmailVerifySuccessDescription",
    className: "text-success",
  },
  expired: {
    icon: Clock,
    titleKey: "beneficiaryEmailVerifyExpiredTitle",
    descriptionKey: "beneficiaryEmailVerifyExpiredDescription",
    className: "text-warning-foreground",
  },
  used: {
    icon: CheckCircle2,
    titleKey: "beneficiaryEmailVerifyUsedTitle",
    descriptionKey: "beneficiaryEmailVerifyUsedDescription",
    className: "text-success",
  },
  invalid: {
    icon: XCircle,
    titleKey: "beneficiaryEmailVerifyInvalidTitle",
    descriptionKey: "beneficiaryEmailVerifyInvalidDescription",
    className: "text-destructive",
  },
};

function isVerificationStatus(value: string | null): value is VerificationStatus {
  return value === "success" || value === "expired" || value === "used" || value === "invalid";
}

export default function VerifyBeneficiaryEmailPage() {
  const t = useTranslations();
  const searchParams = useSearchParams();
  const rawStatus = searchParams.get("status");
  const status: VerificationStatus = isVerificationStatus(rawStatus) ? rawStatus : "invalid";
  const config = STATUS_CONFIG[status];
  const Icon = config.icon;

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background">
      <div className="max-w-md w-full glass-panel rounded-2xl p-8 text-center space-y-4">
        <div className={`mx-auto h-16 w-16 rounded-full bg-muted/30 flex items-center justify-center ${config.className}`}>
          <Icon className="h-8 w-8" />
        </div>
        <h1 className="text-2xl font-bold">{t(config.titleKey)}</h1>
        <p className="text-muted-foreground">{t(config.descriptionKey)}</p>
        <Link
          href="https://iablee.com"
          className="inline-block text-sm font-medium text-link hover:underline"
        >
          {t("learnMoreAboutIablee")}
        </Link>
      </div>
    </div>
  );
}
