import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  /* Transform only — do not transition box-shadow (dual-tone focus rings must snap;
   * interpolating shadow-lg → focus halo leaves white-on-white mid-frames ~1:1). */
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-transform active:scale-[0.98] disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:ring-0 aria-invalid:outline-destructive aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default:
          /* Opaque primary + label; tokenised disabled (WCAG-exempt but consistent). */
          "bg-primary text-primary-foreground shadow-lg shadow-primary/25 hover:bg-[color:var(--btn-gradient-hover-from)] hover:shadow-primary/40 disabled:bg-btn-disabled-bg disabled:text-btn-disabled-fg disabled:opacity-100 disabled:shadow-none",
        destructive:
          "bg-destructive text-destructive-foreground shadow-sm hover:bg-[color:var(--destructive)] disabled:bg-btn-disabled-destructive-bg disabled:text-btn-disabled-destructive-fg disabled:opacity-100 disabled:shadow-none",
        outline:
          /* Dark: opaque card halo so ui-border’s ≈4px outside samples hit --card, not photo wash.
           * Hover uses opaque --accent (not bg-input/50) — light --input @50% over card ≈#6a81a2
           * washes label to ~3.44:1 under axe when the pointer rests on the control. */
          "border border-input bg-background text-foreground shadow-sm hover:bg-accent hover:text-accent-foreground dark:bg-card dark:text-foreground dark:border-input dark:shadow-[0_0_0_6px_var(--card)] dark:hover:bg-accent disabled:opacity-100 disabled:bg-muted disabled:text-muted-foreground disabled:border-border dark:disabled:bg-btn-disabled-bg dark:disabled:text-btn-disabled-fg",
        secondary:
          "bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary disabled:opacity-100 disabled:bg-muted disabled:text-muted-foreground",
        ghost:
          "text-foreground hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50 disabled:opacity-100 disabled:text-muted-foreground",
        link: "text-link underline-offset-4 hover:underline disabled:opacity-100 disabled:text-muted-foreground",
        premium:
          "btn-primary-gradient text-primary-foreground shadow-lg shadow-primary/25 hover:shadow-primary/40 border-0 disabled:opacity-100 disabled:shadow-none",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4 text-base",
        icon: "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
