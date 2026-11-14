"use client"

import * as React from "react"
import { Eye, EyeOff } from "lucide-react"
import { useTranslations } from "next-intl"

import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"

type PasswordInputProps = Omit<React.ComponentProps<"input">, "type"> & {
  /** Optional override for the visibility toggle aria-labels. */
  showLabel?: string
  hideLabel?: string
}

function PasswordInput({
  className,
  disabled,
  showLabel,
  hideLabel,
  ...props
}: PasswordInputProps) {
  const t = useTranslations()
  const [visible, setVisible] = React.useState(false)

  const ariaLabel = visible
    ? (hideLabel ?? t("hidePassword"))
    : (showLabel ?? t("showPassword"))

  return (
    <div className="relative">
      <Input
        {...props}
        type={visible ? "text" : "password"}
        disabled={disabled}
        className={cn("pr-10", className)}
      />
      <button
        type="button"
        tabIndex={0}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-pressed={visible}
        onClick={() => setVisible((v) => !v)}
        className={cn(
          "absolute inset-y-0 right-0 flex w-9 items-center justify-center rounded-r-md text-muted-foreground",
          "hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
          "disabled:pointer-events-none disabled:opacity-50",
        )}
      >
        {visible ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
      </button>
    </div>
  )
}

export { PasswordInput }
