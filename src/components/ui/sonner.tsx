"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, toast, type ToasterProps } from "sonner"

// E2E contrast audits trigger real Sonner toasts via the same module singleton.
if (typeof window !== "undefined") {
  ;(window as Window & { __iableeToast?: typeof toast }).__iableeToast = toast
}

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      richColors={false}
      // Token-only toast styling (no Sonner richColors wash). globals.css paints
      // [data-sonner-toast][data-type=…] via --toast-*-* tokens.
      toastOptions={{
        classNames: {
          success: "border border-[var(--toast-success-border)]",
          error: "border border-[var(--toast-error-border)]",
          warning: "border border-[var(--toast-warning-border)]",
        },
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--success-bg": "var(--toast-success-bg)",
          "--success-text": "var(--toast-success-fg)",
          "--success-border": "var(--toast-success-border)",
          "--error-bg": "var(--toast-error-bg)",
          "--error-text": "var(--toast-error-fg)",
          "--error-border": "var(--toast-error-border)",
          "--warning-bg": "var(--toast-warning-bg)",
          "--warning-text": "var(--toast-warning-fg)",
          "--warning-border": "var(--toast-warning-border)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
