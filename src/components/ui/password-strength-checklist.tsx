"use client"

import { Check, X } from "lucide-react"
import { useTranslations } from "next-intl"

import { cn } from "@/lib/utils"
import {
  getChecklistRuleStatus,
  type PasswordPolicyOptions,
  type PasswordRuleId,
} from "@/lib/password-policy"

type PasswordStrengthChecklistProps = {
  password: string
  email?: string | null
  className?: string
}

const RULE_I18N_KEYS: Record<
  Exclude<PasswordRuleId, "maxLength">,
  string
> = {
  minLength: "passwordPolicy.minLength",
  uppercase: "passwordPolicy.uppercase",
  lowercase: "passwordPolicy.lowercase",
  number: "passwordPolicy.number",
  special: "passwordPolicy.special",
  noSequence: "passwordPolicy.noSequence",
  noRepeat: "passwordPolicy.noRepeat",
  notEmail: "passwordPolicy.notEmail",
}

export function PasswordStrengthChecklist({
  password,
  email,
  className,
}: PasswordStrengthChecklistProps) {
  const t = useTranslations()
  const options: PasswordPolicyOptions = { email }
  const rules = getChecklistRuleStatus(password, options).filter((r) => r.visible)
  const allMet = rules.length > 0 && rules.every((r) => r.met)

  return (
    <div className={cn("space-y-1.5", className)}>
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {allMet && password.length > 0
          ? t("passwordPolicy.strong")
          : t("passwordPolicy.requirements")}
      </p>
      <ul className="space-y-1" aria-live="polite">
        {rules.map((rule) => (
          <li
            key={rule.id}
            className={cn(
              "flex items-start gap-2 text-xs",
              rule.met ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground",
            )}
          >
            {rule.met ? (
              <Check className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            ) : (
              <X className="mt-0.5 size-3.5 shrink-0 opacity-70" aria-hidden />
            )}
            <span>{t(RULE_I18N_KEYS[rule.id as Exclude<PasswordRuleId, "maxLength">])}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
