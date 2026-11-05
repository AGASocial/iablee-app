import { HeartHandshake, ShieldCheck, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

interface WelcomeStepProps {
  userName: string;
  onStart: () => void;
  translate: (key: string, values?: Record<string, string | number>) => string;
}

export function WelcomeStep({ userName, onStart, translate }: WelcomeStepProps) {
  return (
    <section className="space-y-6">
      <div className="space-y-3">
        <h1 className="font-heading text-3xl text-foreground">
          {translate("wizard-welcome-hero-title", { name: userName })}
        </h1>
        <p className="text-base text-muted-foreground">{translate("wizard-welcome-hero-description")}</p>
      </div>

      <ul className="grid gap-3 sm:grid-cols-3">
        <li className="rounded-xl border border-border bg-brand-tint p-4">
          <ShieldCheck className="mb-2 h-5 w-5 text-primary" aria-hidden="true" />
          <p className="text-sm text-foreground">{translate("wizard-welcome-benefit-security")}</p>
        </li>
        <li className="rounded-xl border border-border bg-brand-chip p-4">
          <HeartHandshake className="mb-2 h-5 w-5 text-primary" aria-hidden="true" />
          <p className="text-sm text-foreground">{translate("wizard-welcome-benefit-family")}</p>
        </li>
        <li className="rounded-xl border border-border bg-card p-4">
          <Sparkles className="mb-2 h-5 w-5 text-primary" aria-hidden="true" />
          <p className="text-sm text-foreground">{translate("wizard-welcome-benefit-easy")}</p>
        </li>
      </ul>

      <Button onClick={onStart} className="h-11 w-full sm:w-auto">
        {translate("wizard-start")}
      </Button>
    </section>
  );
}
