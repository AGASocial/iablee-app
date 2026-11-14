import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex h-9 w-full min-w-0 rounded-md border border-input bg-input-fill px-3 py-1 text-sm text-foreground caret-foreground shadow-sm transition-all",
        "placeholder:text-placeholder placeholder:opacity-100",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:ring-0",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "aria-invalid:border-destructive aria-invalid:outline-destructive",
        className
      )}
      {...props}
    />
  )
}

export { Input }
